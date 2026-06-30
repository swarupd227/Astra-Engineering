import Anthropic from '@anthropic-ai/sdk';
import { llm } from '../llm-config';
import { isAwsHosting } from '../platform/hosting';

/**
 * QE AI Client — routes through the hosting-aware unified LLM facade.
 *
 * Historically this client POSTed straight to Azure OpenAI. That made every
 * QE/NAT/ATA feature fail on pure-AWS deployments that only configure Bedrock.
 *
 * Now we build an OpenAI-shape request (so vision content stays as
 * `image_url` blocks) and dispatch through `llm.selected.chat.completions.create`,
 * which resolves to Bedrock Converse on `DEVX_HOSTING=aws` and Azure OpenAI on
 * `DEVX_HOSTING=azure`. The exported `qeAnthropicClient` keeps its
 * Anthropic-SDK shape, so the 17 QE modules that import it continue to work
 * unchanged.
 */

interface MessageCreateParams {
  model?: string;
  max_tokens: number;
  messages: Array<{ role: string; content: any }>;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface MessageResponse {
  content: ContentBlock[];
  model: string;
  stop_reason: string;
}

/**
 * Translate Anthropic-style content blocks to OpenAI-style. Mirrors the
 * translation the previous Azure-OpenAI-only implementation performed; the
 * Bedrock side reverses this back to Converse blocks inside bedrock-impl.ts.
 */
function toOpenAIContent(content: any): any {
  if (!Array.isArray(content)) return content;
  const parts: any[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image' && block.source?.type === 'base64') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    } else if (block.type === 'image_url' && block.image_url?.url) {
      // Already OpenAI-shape — pass through unchanged.
      parts.push(block);
    }
  }
  return parts;
}

async function callUnifiedLlm(params: MessageCreateParams): Promise<MessageResponse> {
  const openaiMessages: Array<{ role: string; content: any }> = [];
  if (params.system) {
    openaiMessages.push({ role: 'system', content: params.system });
  }
  for (const msg of params.messages) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    openaiMessages.push({ role, content: toOpenAIContent(msg.content) });
  }

  const tokenLimit = Math.min(params.max_tokens, 16000);
  const body: any = {
    messages: openaiMessages,
    max_completion_tokens: tokenLimit,
    max_tokens: tokenLimit, // bedrock-impl reads either field; Azure path picks the right one
  };
  if (params.model) body.model = params.model;
  if (typeof params.temperature !== 'undefined') body.temperature = params.temperature;
  if (params.top_p) body.top_p = params.top_p;
  if (params.stop_sequences) body.stop = params.stop_sequences;

  const backend = isAwsHosting() ? 'bedrock' : 'azure-openai';
  console.log(`[QE AI] LLM call backend=${backend} max_tokens=${tokenLimit}`);

  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data: any = await llm.selected.chat.completions.create(body);
      const text = data?.choices?.[0]?.message?.content || '';
      const finishReason = data?.choices?.[0]?.finish_reason || 'end_turn';
      const modelName =
        (typeof data?.model === 'string' && data.model) ||
        params.model ||
        backend;

      return {
        content: [{ type: 'text', text }],
        model: modelName,
        stop_reason: finishReason,
      };
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || '';
      const name = err?.name || '';
      const transientPatterns = [
        // OpenAI / Azure transport errors
        'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'fetch failed',
        // OpenAI / Azure HTTP statuses
        '429', '529', '503',
        // Bedrock SDK exceptions
        'ThrottlingException',
        'ServiceUnavailableException',
        'ModelTimeoutException',
        'InternalServerException',
      ];
      const isTransient = transientPatterns.some(p => msg.includes(p) || name.includes(p));
      if (attempt < maxAttempts && isTransient) {
        const delay = 3000 * attempt;
        console.log(`[QE AI] Attempt ${attempt} failed (${(msg || name).slice(0, 120)}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

/**
 * SDK-compatible wrapper: exposes `messages.create()` but dispatches through
 * the unified hosting-aware LLM facade. All QE modules import this and use it
 * like the standard Anthropic client.
 */
export const qeAnthropicClient = {
  messages: {
    async create(params: MessageCreateParams): Promise<MessageResponse> {
      return callUnifiedLlm(params);
    },
    stream(params: MessageCreateParams): AsyncIterable<any> & { finalMessage: () => Promise<MessageResponse> } {
      let result: MessageResponse | null = null;
      const iterable = {
        async *[Symbol.asyncIterator]() {
          result = await callUnifiedLlm(params);
          const text = result.content[0]?.text || '';
          // Emit the full response as a single text_delta event (matches Anthropic SDK format)
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
        },
        async finalMessage(): Promise<MessageResponse> {
          if (!result) result = await callUnifiedLlm(params);
          return result;
        },
      };
      return iterable;
    },
  },
} as unknown as Anthropic;

export function createQeAnthropicClient(): Anthropic {
  return qeAnthropicClient;
}

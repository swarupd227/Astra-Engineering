import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { isAwsHosting } from "../hosting";
import { recordAiUsage } from "../../observability/ai-usage-recorder";
import {
  extractProviderCacheUsage,
  getEffectivePromptCacheTtl,
  isPromptCacheEnabled,
} from "../../observability/prompt-cache";

export const hasBedrock = true as const;
export const hasAzureOpenAI = false;
export const hasAnthropic = false;

// `loadSecrets()` runs inside the async IIFE in server/index.ts AFTER static
// imports resolve, so reading these env vars at module-load time would lock
// in the fallback values even when AWS Secrets Manager later populates them.
// We resolve lazily on first call (and cache the result thereafter) so any
// post-bootstrap secret injection is honored. The cache resets only on
// process restart, which matches normal pod lifecycle.
let _resolvedRegion: string | null = null;
let _resolvedModelId: string | null = null;
function resolveBedrockRegion(): string {
  if (_resolvedRegion) return _resolvedRegion;
  const v = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
  _resolvedRegion = v;
  return v;
}
function resolveBedrockModelId(): string {
  if (_resolvedModelId) return _resolvedModelId;
  const v = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-6-v1";
  _resolvedModelId = v;
  return v;
}
const BEDROCK_TIMEOUT_MS = 600000;

// Per-model output ceilings for AWS Bedrock Claude models.
// Source: AWS Bedrock model cards (Anthropic Claude family).
// These are conservative upper bounds for single-shot generation; the
// continuation loop in createCompletion will transparently extend output
// beyond these if the model still hits the cap.
const MODEL_OUTPUT_CEILINGS: Array<{ match: RegExp; ceiling: number }> = [
  { match: /claude-opus-4(?!-?[0-3])/i, ceiling: 32000 },     // Opus 4.x (4, 4.5, 4.6)
  { match: /claude-sonnet-4(?!-?[0-3])/i, ceiling: 32000 },   // Sonnet 4.x (4, 4.5)
  { match: /claude-3-7-sonnet/i, ceiling: 32000 },
  { match: /claude-3-5-sonnet/i, ceiling: 8192 },
  { match: /claude-3-5-haiku/i, ceiling: 8192 },
  { match: /claude-3/i, ceiling: 4096 },                      // Legacy Claude 3 Opus/Sonnet/Haiku
];

const DEFAULT_MODEL_CEILING = 8192;

function resolveModelCeiling(modelId: string): number {
  const envOverride = process.env.BEDROCK_MAX_OUTPUT_TOKENS;
  if (envOverride) {
    const parsed = parseInt(envOverride, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  for (const { match, ceiling } of MODEL_OUTPUT_CEILINGS) {
    if (match.test(modelId)) return ceiling;
  }
  return DEFAULT_MODEL_CEILING;
}

// Maximum number of follow-up Converse calls when the model stops at the
// max_tokens boundary. Keeps total wall-clock bounded for any single page.
const MAX_CONTINUATIONS = 3;

let _bedrockRuntime: BedrockRuntimeClient | null = null;
function getBedrockRuntime(): BedrockRuntimeClient {
  if (!_bedrockRuntime) {
    _bedrockRuntime = new BedrockRuntimeClient({
      region: resolveBedrockRegion(),
      requestHandler: { requestTimeout: BEDROCK_TIMEOUT_MS } as any,
    });
  }
  return _bedrockRuntime;
}

// ─── OpenAI-shape → Bedrock Converse content translation ─────────────────────
// Callers pass content as either a string (plain text) or an array of
// OpenAI-style blocks { type: 'text', text } / { type: 'image_url', image_url:
// { url: 'data:image/<fmt>;base64,<b64>' } }. Bedrock Converse needs blocks of
// { text } or { image: { format, source: { bytes: Uint8Array } } }. We accept
// both shapes so this client is a drop-in replacement for QE/Azure-OpenAI
// flows that send vision inputs.
type ConverseContentBlock =
  | { text: string }
  | { image: { format: "png" | "jpeg" | "gif" | "webp"; source: { bytes: Uint8Array } } }
  | { cachePoint: { type: "default"; ttl?: "5m" | "1h" } };

const BEDROCK_SUPPORTED_IMAGE_FORMATS = new Set(["png", "jpeg", "gif", "webp"]);

function extractSystemText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as any).type === "text" && typeof (block as any).text === "string") {
      parts.push((block as any).text);
    }
  }
  return parts.join("\n");
}

function pushBedrockImageBlock(
  blocks: ConverseContentBlock[],
  mediaType: string,
  base64Data: string,
): void {
  const m = /^image\/([a-zA-Z0-9+.-]+)$/.exec(mediaType.trim());
  if (!m) {
    console.warn(`[Bedrock] Skipping image with malformed media type=${mediaType}`);
    return;
  }
  let fmt = m[1].toLowerCase();
  if (fmt === "jpg") fmt = "jpeg";
  if (!BEDROCK_SUPPORTED_IMAGE_FORMATS.has(fmt)) {
    console.warn(`[Bedrock] Skipping image with unsupported format=${fmt} (Converse supports png, jpeg, gif, webp)`);
    return;
  }
  try {
    const bytes = Buffer.from(base64Data, "base64");
    blocks.push({ image: { format: fmt as "png" | "jpeg" | "gif" | "webp", source: { bytes } } });
  } catch (err: any) {
    console.warn(`[Bedrock] Failed to decode image base64: ${err?.message || err}`);
  }
}

function translateMessageContent(content: unknown): ConverseContentBlock[] {
  if (typeof content === "string") {
    return [{ text: content || "" }];
  }
  if (!Array.isArray(content)) {
    return [{ text: "" }];
  }
  const blocks: ConverseContentBlock[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as any;
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ text: block.text });
    } else if (block.type === "image_url" && block.image_url?.url) {
      // OpenAI-style: { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
      const url: string = block.image_url.url;
      const m = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(url);
      if (!m) {
        console.warn("[Bedrock] Skipping image_url (Converse requires inline data:image/...;base64,... URL)");
        continue;
      }
      pushBedrockImageBlock(blocks, m[1], m[2]);
    } else if (block.type === "image" && block.source?.type === "base64" && block.source.media_type && block.source.data) {
      // Anthropic-style: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
      // BRD service and others pass this directly to azureOpenAI/bedrockLLM
      // without going through the ai-client OpenAI translation, so we accept
      // both shapes defensively at this final translation point.
      pushBedrockImageBlock(blocks, block.source.media_type, block.source.data);
    }
  }
  if (blocks.length === 0) {
    blocks.push({ text: "" });
  }
  return blocks;
}

class BedrockLLMClient {
  // When `_modelIdOverride` is undefined the model ID resolves lazily on each
  // access (so `loadSecrets()` populating BEDROCK_MODEL_ID after module-load
  // is honored). Callers that explicitly pass a model still pin it.
  private _modelIdOverride?: string;

  constructor(modelId?: string) {
    this._modelIdOverride = modelId;
  }

  get modelId(): string {
    return this._modelIdOverride ?? resolveBedrockModelId();
  }

  async createCompletion(params: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string | any[];
      cachePoint?: boolean;
    }>;
    max_tokens?: number;
    max_completion_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
    model?: string;
    stop?: string[];
  }) {
    const cacheTtl = getEffectivePromptCacheTtl(params.model || this.modelId);
    const requestedMaxTokens =
      params.max_completion_tokens ?? params.max_tokens ?? 16000;

    let systemPrompt: string | undefined;
    let systemCachePoint = false;
    const converseMessages: Array<{
      role: "user" | "assistant";
      content: ConverseContentBlock[];
    }> = [];

    for (const msg of params.messages) {
      if (msg.role === "system") {
        systemPrompt = extractSystemText(msg.content);
        if (msg.cachePoint) systemCachePoint = true;
      } else {
        const content = translateMessageContent(msg.content);
        if (msg.cachePoint) {
          content.push({ cachePoint: { type: "default", ttl: cacheTtl } });
        }
        converseMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content,
        });
      }
    }

    if (converseMessages.length === 0 || converseMessages[0].role !== "user") {
      converseMessages.unshift({
        role: "user",
        content: [{ text: systemPrompt || "Hello" }],
      });
      systemPrompt = undefined;
    }

    // Per-model output ceiling — modern Claude Opus/Sonnet 4.x supports up to
    // 32K-128K output tokens on Bedrock. The previous hard cap of 4096 was a
    // legacy Claude-3-era safety value and silently truncated long generations
    // (e.g. Confluence wiki pages). Honor the caller's request up to the
    // model's safe ceiling; the continuation loop below picks up the rest.
    const modelCeiling = resolveModelCeiling(this.modelId);
    const effectiveMaxTokens = Math.min(requestedMaxTokens, modelCeiling);

    const stopSeqs = params.stop_sequences ?? params.stop;

    const buildInferenceConfig = (maxTokensForCall: number): any => {
      const cfg: any = { maxTokens: maxTokensForCall };
      if (typeof params.temperature !== "undefined") {
        cfg.temperature = params.temperature;
      }
      if (params.top_p) {
        cfg.topP = params.top_p;
      }
      if (stopSeqs && stopSeqs.length > 0) {
        cfg.stopSequences = stopSeqs;
      }
      return cfg;
    };

    const sendOnce = async (
      messages: typeof converseMessages,
      maxTokensForCall: number,
    ) => {
      const commandInput: any = {
        modelId: this.modelId,
        messages,
        inferenceConfig: buildInferenceConfig(maxTokensForCall),
      };
      if (systemPrompt) {
        commandInput.system = [{ text: systemPrompt }];
        if (systemCachePoint) {
          commandInput.system.push({ cachePoint: { type: "default", ttl: cacheTtl } });
        }
      }

      if (isPromptCacheEnabled() && systemCachePoint) {
        const userCachePoints = messages.filter((m) =>
          m.content.some((c: any) => c.cachePoint),
        ).length;
        console.log(
          `[Bedrock] prompt cache markers: system=1 user_cache_points=${userCachePoints} model=${this.modelId}`,
        );
      }

      const maxAttempts = 3;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await getBedrockRuntime().send(new ConverseCommand(commandInput));
        } catch (error: any) {
          lastError = error;
          const isThrottled =
            error.name === "ThrottlingException" ||
            error.$metadata?.httpStatusCode === 429;
          if (isThrottled && attempt < maxAttempts) {
            const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            console.warn(
              `[Bedrock] Throttled (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
            );
            await new Promise((r) => setTimeout(r, delayMs));
          } else {
            throw error;
          }
        }
      }
      throw lastError;
    };

    const usageStartedAt = Date.now();
    try {
    let aggregatedCacheTokens = 0;
    let aggregatedCacheWriteTokens = 0;

    const accumulateCacheUsage = (usage: Record<string, unknown> | undefined) => {
      const { cacheRead, cacheWrite } = extractProviderCacheUsage(usage);
      aggregatedCacheTokens += cacheRead;
      aggregatedCacheWriteTokens += cacheWrite;
    };

    // Initial call.
    let response = await sendOnce(converseMessages, effectiveMaxTokens);
    let aggregatedText =
      response.output?.message?.content?.find((c: any) => c.text)?.text || "";
    let aggregatedInputTokens = response.usage?.inputTokens || 0;
    let aggregatedOutputTokens = response.usage?.outputTokens || 0;
    let aggregatedTotalTokens = response.usage?.totalTokens || 0;
    accumulateCacheUsage(response.usage as Record<string, unknown> | undefined);
    let finalStopReason = response.stopReason || "stop";
    let continuations = 0;

    // Continuation loop: if the model stopped because it hit max_tokens, ask
    // it to keep going from where it left off and stitch the output together.
    // Skipped when the caller specified custom stopSequences, since "continue"
    // semantics there are caller-defined and unsafe to auto-extend.
    const continuationSafe = !stopSeqs || stopSeqs.length === 0;
    while (
      continuationSafe &&
      finalStopReason === "max_tokens" &&
      continuations < MAX_CONTINUATIONS &&
      aggregatedText.length > 0
    ) {
      continuations += 1;
      const continuationMessages: typeof converseMessages = [
        ...converseMessages,
        {
          role: "assistant",
          content: [{ text: aggregatedText }],
        },
        {
          role: "user",
          content: [
            {
              text:
                "Continue exactly where you left off. Do not repeat any previous content, " +
                "do not re-introduce the topic, and do not add a preamble. Resume mid-sentence " +
                "if necessary so the final document reads as one continuous piece.",
            },
          ],
        },
      ];

      console.warn(
        `[Bedrock] stopReason=max_tokens after ${aggregatedOutputTokens} tokens — ` +
          `issuing continuation ${continuations}/${MAX_CONTINUATIONS} (model=${this.modelId})`,
      );

      response = await sendOnce(continuationMessages, effectiveMaxTokens);
      const nextText =
        response.output?.message?.content?.find((c: any) => c.text)?.text || "";
      if (!nextText) {
        // Nothing to append — stop to avoid an infinite loop on a degenerate response.
        break;
      }
      // Join with a single newline so paragraph/table boundaries survive but
      // we don't accidentally insert duplicate whitespace runs.
      aggregatedText =
        aggregatedText.endsWith("\n") || nextText.startsWith("\n")
          ? aggregatedText + nextText
          : aggregatedText + "\n" + nextText;
      aggregatedInputTokens += response.usage?.inputTokens || 0;
      aggregatedOutputTokens += response.usage?.outputTokens || 0;
      aggregatedTotalTokens += response.usage?.totalTokens || 0;
      accumulateCacheUsage(response.usage as Record<string, unknown> | undefined);
      finalStopReason = response.stopReason || "stop";
    }

    if (
      finalStopReason === "max_tokens" &&
      continuations >= MAX_CONTINUATIONS
    ) {
      console.warn(
        `[Bedrock] WARNING: still hitting max_tokens after ${MAX_CONTINUATIONS} continuations ` +
          `(model=${this.modelId}, totalOutputTokens=${aggregatedOutputTokens}). ` +
          `Output may still be incomplete; consider raising BEDROCK_MAX_OUTPUT_TOKENS or splitting the prompt.`,
      );
    } else {
      console.log(
        `[Bedrock] stopReason=${finalStopReason} outputTokens=${aggregatedOutputTokens} ` +
          `continuations=${continuations} model=${this.modelId}`,
      );
    }

    // Universal AI usage capture (fire-and-forget; respects skipLogging via context).
    recordAiUsage({
      model: this.modelId,
      provider: "claude",
      inputTokens: aggregatedInputTokens,
      outputTokens: aggregatedOutputTokens,
      cacheTokens: aggregatedCacheTokens,
      cacheWriteTokens: aggregatedCacheWriteTokens,
      requestStatus: "success",
      latencyMs: Date.now() - usageStartedAt,
      requestMetadata: {
        finishReason: finalStopReason,
        continuations,
        cacheReadInputTokens: aggregatedCacheTokens,
        cacheWriteInputTokens: aggregatedCacheWriteTokens,
      },
    });

    return {
      choices: [
        {
          message: { content: aggregatedText, role: "assistant" as const },
          finish_reason: finalStopReason,
          index: 0,
        },
      ],
      usage: {
        prompt_tokens: aggregatedInputTokens,
        completion_tokens: aggregatedOutputTokens,
        total_tokens: aggregatedTotalTokens,
      },
    };
    } catch (err: any) {
      // Capture failed calls so reliability metrics are accurate.
      recordAiUsage({
        model: this.modelId,
        provider: "claude",
        requestStatus: "failed",
        latencyMs: Date.now() - usageStartedAt,
        requestMetadata: { error: String(err?.message || err) },
      });
      throw err;
    }
  }

  get chat() {
    return {
      completions: {
        create: this.createCompletion.bind(this),
      },
    };
  }
}

let _resolvedEmbeddingModelId: string | null = null;
function resolveBedrockEmbeddingModelId(): string {
  if (_resolvedEmbeddingModelId) return _resolvedEmbeddingModelId;
  const v = process.env.BEDROCK_EMBEDDING_MODEL_ID || "amazon.titan-embed-text-v2:0";
  _resolvedEmbeddingModelId = v;
  return v;
}

class BedrockEmbeddingClient {
  private _modelIdOverride?: string;

  constructor(modelId?: string) {
    this._modelIdOverride = modelId;
  }

  get modelId(): string {
    return this._modelIdOverride ?? resolveBedrockEmbeddingModelId();
  }

  get embeddings() {
    return {
      create: async (params: { model?: string; input: string | string[] }) => {
        const texts = Array.isArray(params.input) ? params.input : [params.input];
        const data: Array<{ embedding: number[]; index: number }> = [];
        const modelUsed = params.model || this.modelId;
        const startedAt = Date.now();
        let inputTokenTotal = 0;

        try {
          for (let i = 0; i < texts.length; i++) {
            const body = JSON.stringify({ inputText: texts[i], normalize: true });
            const response = await getBedrockRuntime().send(
              new InvokeModelCommand({
                modelId: modelUsed,
                contentType: "application/json",
                accept: "application/json",
                body: new TextEncoder().encode(body),
              })
            );
            const result = JSON.parse(new TextDecoder().decode(response.body));
            data.push({ embedding: result.embedding, index: i });
            inputTokenTotal +=
              Number(result.inputTextTokenCount) ||
              Math.ceil((texts[i]?.length || 0) / 4); // estimate if not reported
          }
        } catch (err: any) {
          recordAiUsage({
            model: modelUsed,
            provider: "bedrock",
            feature: "embedding",
            useCase: "embedding",
            requestStatus: "failed",
            latencyMs: Date.now() - startedAt,
            requestMetadata: { error: String(err?.message || err) },
          });
          throw err;
        }

        // Embeddings: input-only tokens, no output, no cache.
        recordAiUsage({
          model: modelUsed,
          provider: "bedrock",
          feature: "embedding",
          useCase: "embedding",
          inputTokens: inputTokenTotal,
          outputTokens: 0,
          cacheTokens: 0,
          requestStatus: "success",
          latencyMs: Date.now() - startedAt,
        });

        return { data, model: this.modelId, usage: { prompt_tokens: inputTokenTotal, total_tokens: inputTokenTotal } };
      },
    };
  }
}

export const bedrockEmbeddingClient = new BedrockEmbeddingClient();

const bedrockLLM = new BedrockLLMClient();

/** OpenAI-shaped client for code that forces "Azure" path -- on AWS it is Bedrock. */
export const azureOpenAI = bedrockLLM as any;
/** OpenAI-shaped client for code that forces Anthropic path -- on AWS it is Bedrock. */
export const anthropic = bedrockLLM as any;

export const workflowAzureInstances = [
  // `deployment` is read on-demand by callers; we expose it as a getter so the
  // late-resolved model ID is visible after Secrets Manager bootstrap.
  Object.defineProperties({ client: bedrockLLM as any, name: "Bedrock_1" } as {
    client: any;
    name: string;
    deployment: string;
  }, {
    deployment: { enumerable: true, get: () => resolveBedrockModelId() },
  }),
];
export const hasWorkflowInstances = true;

export function getSelectedLLM() {
  return bedrockLLM;
}

export const LLM = bedrockLLM;

export const llm = {
  selected: {
    chat: {
      completions: {
        create: async (params: any) => bedrockLLM.chat.completions.create(params),
      },
    },
  },
  azureOpenAI: {
    chat: {
      completions: {
        create: async (params: any) => bedrockLLM.chat.completions.create(params),
      },
    },
  },
  anthropic: {
    chat: {
      completions: {
        create: async (params: any) => bedrockLLM.chat.completions.create(params),
      },
    },
  },
};

// llmConfig exposes diagnostic strings (model ID, deployment name) via getters
// so they reflect any model/region values populated by `loadSecrets()` after
// this module finishes initialising. Existing callers that read these as
// plain string properties keep working.
export const llmConfig = Object.defineProperties(
  {
    hasAzureOpenAI: false,
    hasAnthropic: false,
    hasBedrock: true,
    selectedLLM: "BEDROCK",
    availableLLMs: ["Bedrock"],
    anthropicVersion: "bedrock-converse",
  } as {
    hasAzureOpenAI: boolean;
    hasAnthropic: boolean;
    hasBedrock: boolean;
    selectedLLM: string;
    availableLLMs: string[];
    anthropicVersion: string;
    activeLLM: string;
    anthropicModel: string;
    azureOpenAIDeployment: string;
  },
  {
    activeLLM: { enumerable: true, get: () => `Bedrock (${resolveBedrockModelId()})` },
    anthropicModel: { enumerable: true, get: () => resolveBedrockModelId() },
    azureOpenAIDeployment: { enumerable: true, get: () => resolveBedrockModelId() },
  },
);

if (isAwsHosting()) {
  // Log placeholder values at module load; the real model/region may be
  // populated later by `loadSecrets()`. The first call to `getBedrockRuntime`
  // captures the final region; the first LLM call uses the final model ID.
  console.log("[LLM Config] Using Amazon Bedrock");
  console.log(`[LLM Config] Model: ${process.env.BEDROCK_MODEL_ID || "(pending Secrets Manager)"}`);
  console.log(`[LLM Config] Region: ${process.env.BEDROCK_REGION || process.env.AWS_REGION || "(pending Secrets Manager)"}`);
}

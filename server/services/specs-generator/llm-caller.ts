import { hasBedrock, llm, llmConfig } from "../../llm-config";
import { withAiContext } from "../../observability/ai-context";
import {
  buildCachedMessages,
  resolvePromptCacheKey,
  type PromptCacheProvider,
} from "../../observability/prompt-cache";

export interface LlmCallOptions {
  systemPrompt: string;
  /** Legacy single user blob (used when staticUser/dynamicUser not set). */
  userPrompt?: string;
  /** Cache-friendly static user prefix (e.g. feature context). */
  staticUser?: string;
  /** Dynamic suffix — dates, per-call instructions (comes last). */
  dynamicUser?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

function resolveModel(): string {
  return (
    process.env.ANTHROPIC_MODEL_NAME_specs ||
    process.env.BEDROCK_MODEL_ID ||
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    (llmConfig as any)?.azureOpenAIDeployment ||
    "gpt-4-turbo"
  );
}

function resolveSpecsPromptProvider(): PromptCacheProvider {
  if (hasBedrock) return "bedrock";
  if (process.env.ANTHROPIC_AZURE_ENDPOINT && process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  return "openai";
}

function buildMessages(options: LlmCallOptions) {
  if (options.staticUser != null && options.dynamicUser != null) {
    return buildCachedMessages({
      staticSystem: options.systemPrompt,
      staticUser: options.staticUser,
      dynamicUser: options.dynamicUser,
      provider: resolveSpecsPromptProvider(),
    }).messages;
  }
  return [
    { role: "system" as const, content: options.systemPrompt },
    { role: "user" as const, content: options.userPrompt || "" },
  ];
}

export async function callLlm(options: LlmCallOptions): Promise<string> {
  const {
    temperature = 0.2,
    maxTokens = 6000,
  } = options;

  const messages = buildMessages(options);

  const response = await withAiContext({ feature: "specs", useCase: "specs generation" }, () =>
    llm.selected.chat.completions.create({
      model: options.model || resolveModel(),
      messages,
      prompt_cache_key: resolvePromptCacheKey(),
      temperature,
      max_tokens: maxTokens,
    }),
  );

  const content = response.choices?.[0]?.message?.content || "";
  return content.trim();
}

/**
 * Retry wrapper for Azure OpenAI rate limits.
 * Retries when a 429 / rate limit error is detected.
 */
export async function callLlmWithRetry(
  label: string,
  options: LlmCallOptions,
  maxAttempts: number = 3,
): Promise<string> {
  let attempt = 0;
  let lastError: any;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await callLlm(options);
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || "").toLowerCase();
      const isRateLimit =
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("quota");

      if (!isRateLimit || attempt >= maxAttempts) {
        throw err;
      }

      const delayMs = 60_000;
      console.warn(
        `[SpecsGenerator] ${label} hit rate limit (attempt ${attempt}/${maxAttempts}). Retrying in ${
          delayMs / 1000
        }s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

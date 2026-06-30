import { hasAnthropic, hasBedrock, azureOpenAI as bedrockClient } from "./llm-config";
import { recordAiUsage } from "./observability/ai-usage-recorder";
import {
  getEffectivePromptCacheTtl,
  isPromptCacheEnabled,
  resolvePromptCacheKey,
} from "./observability/prompt-cache";

type OpenAILike = any;
type RuntimeProvider =
  | "bedrock"
  | "azure-openai"
  | "openai"
  | "ai-integrations-openai"
  | "anthropic-azure"
  | "unconfigured";

export interface AiProviderInfo {
  provider: RuntimeProvider;
  model?: string;
}

const useAnthropic = hasAnthropic && !hasBedrock;
const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT || "").toLowerCase();
const isNewAzureModel =
  deployment.includes("gpt-5") ||
  deployment.includes("o1") ||
  deployment.includes("o3");

// Repo rule: all ad hoc OpenAI / Azure OpenAI SDK construction should happen here.
let sdkInstance: OpenAILike | null = null;
let sdkInitPromise: Promise<OpenAILike> | null = null;

export function getProviderInfo(): AiProviderInfo {
  if (hasBedrock && bedrockClient) {
    return {
      provider: "bedrock",
      model: process.env.BEDROCK_MODEL_ID || "bedrock-default",
    };
  }

  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    return {
      provider: "azure-openai",
      model: process.env.AZURE_OPENAI_DEPLOYMENT || "azure-openai-default",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "openai-default",
    };
  }

  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return {
      provider: "ai-integrations-openai",
      model:
        process.env.AI_INTEGRATIONS_OPENAI_MODEL ||
        process.env.OPENAI_MODEL ||
        "ai-integrations-openai-default",
    };
  }

  if (useAnthropic) {
    return {
      provider: "anthropic-azure",
      model: process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5",
    };
  }

  return { provider: "unconfigured" };
}

export function hasConfiguredSdk(): boolean {
  const provider = getProviderInfo().provider;
  return provider === "azure-openai" || provider === "openai" || provider === "ai-integrations-openai";
}

export async function getSdk(): Promise<OpenAILike> {
  if (sdkInstance) return sdkInstance;
  if (sdkInitPromise) return sdkInitPromise;

  sdkInitPromise = (async () => {
    // Prefer Azure OpenAI when configured, then regular OpenAI, then Replit integration
    if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
      const mod = await import("openai");
      const AzureOpenAI = (mod as any).AzureOpenAI;
      sdkInstance = new AzureOpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-02-01",
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      });
      return sdkInstance;
    }

    if (process.env.OPENAI_API_KEY) {
      const mod = await import("openai");
      const OpenAI = (mod as any).default || mod;
      sdkInstance = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return sdkInstance;
    }

    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      const mod = await import("openai");
      const OpenAI = (mod as any).default || mod;
      sdkInstance = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      });
      return sdkInstance;
    }

    throw new Error("No supported AI provider configured");
  })();

  try {
    return await sdkInitPromise;
  } catch (error) {
    sdkInitPromise = null;
    throw error;
  }
}

export async function warmupSdk(): Promise<OpenAILike | null> {
  if (!hasConfiguredSdk()) {
    return null;
  }
  return getSdk();
}

export const ai = {
  chat: {
    completions: {
      create: async (opts: any) => {
        const promptCacheKey = resolvePromptCacheKey(opts?.prompt_cache_key);
        if (hasBedrock && bedrockClient) {
          return bedrockClient.chat.completions.create({
            ...opts,
            prompt_cache_key: promptCacheKey ?? opts?.prompt_cache_key,
          });
        }

        const modelName = typeof opts?.model === "string" ? opts.model.toLowerCase() : "";
        const isClaudeLike =
          modelName.includes("claude") ||
          modelName.includes("sonnet") ||
          modelName.includes("opus") ||
          modelName.includes("haiku") ||
          modelName.startsWith("claude-3-");
        const shouldUseAnthropic = useAnthropic && isClaudeLike;

        if (shouldUseAnthropic) {
          const usageStartedAt = Date.now();
          const useCache = isPromptCacheEnabled();
          // Map OpenAI-style request to the Anthropic Messages API.
          // Direct Anthropic (api.anthropic.com, x-api-key) when no Azure-hosted endpoint is set.
          const anthropicDirect = !process.env.ANTHROPIC_AZURE_ENDPOINT && !!process.env.ANTHROPIC_API_KEY;
          const url =
            process.env.ANTHROPIC_AZURE_ENDPOINT ||
            process.env.ANTHROPIC_BASE_URL ||
            "https://api.anthropic.com/v1/messages";
          const model = opts.model || process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5";
          const anthropicVersion =
            process.env.ANTHROPIC_MODEL_VERSION || "2023-06-01";
          const cacheTtl = getEffectivePromptCacheTtl(model);

          const messages = opts.messages || [];
          const systemParts: any[] = [];
          const anthropicMessages: Array<{ role: "user" | "assistant"; content: any }> = [];
          for (const msg of messages) {
            if (msg.role === "system") {
              if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block?.type === "text" && typeof block.text === "string") {
                    if (msg.cachePoint && useCache && !block.cache_control) {
                      systemParts.push({
                        type: "text",
                        text: block.text,
                        cache_control: { type: "ephemeral", ttl: cacheTtl },
                      });
                    } else {
                      systemParts.push(block);
                    }
                  }
                }
              } else {
                const text = typeof msg.content === "string" ? msg.content : "";
                if (text) {
                  if (msg.cachePoint && useCache) {
                    systemParts.push({
                      type: "text",
                      text,
                      cache_control: { type: "ephemeral", ttl: cacheTtl },
                    });
                  } else {
                    systemParts.push(text);
                  }
                }
              }
              continue;
            }
            const cache = !!msg.cachePoint;
            let content: any = typeof msg.content === "string" ? msg.content : msg.content;
            if (cache && useCache) {
              if (typeof content === "string") {
                content = [{
                  type: "text",
                  text: content,
                  cache_control: { type: "ephemeral", ttl: cacheTtl },
                }];
              } else if (Array.isArray(content)) {
                content = content.map((block: any) => {
                  if (block?.type === "text" && !block.cache_control) {
                    return { ...block, cache_control: { type: "ephemeral", ttl: cacheTtl } };
                  }
                  return block;
                });
              }
            }
            anthropicMessages.push({
              role: msg.role === "assistant" ? "assistant" : "user",
              content,
            });
          }
          if (anthropicMessages.length === 0) {
            anthropicMessages.push({ role: "user", content: "(empty)" });
          }

          const body: any = {
            model: model,
            messages: anthropicMessages,
            max_tokens: opts.max_tokens || opts.maxTokens || 2048,
          };
          if (systemParts.length === 1 && typeof systemParts[0] === "string") {
            body.system = systemParts[0];
          } else if (systemParts.length > 0) {
            body.system = systemParts;
          }

          // Add optional parameters if provided
          if (typeof opts.temperature !== "undefined") {
            body.temperature = opts.temperature;
          }
          if (opts.top_p) {
            body.top_p = opts.top_p;
          }
          if (opts.stop_sequences) {
            body.stop_sequences = opts.stop_sequences;
          }

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "anthropic-version": anthropicVersion,
          };
          if (anthropicDirect) {
            headers["x-api-key"] = process.env.ANTHROPIC_API_KEY || "";
          } else {
            headers["Authorization"] = `Bearer ${process.env.ANTHROPIC_API_KEY}`;
          }

          try {
            const resp = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            });

            if (!resp.ok) {
              const text = await resp.text();
              throw new Error(`Anthropic request failed: ${resp.status} ${resp.statusText} - ${text}`);
            }

            const data = await resp.json();

            // Extract content from Anthropic response
            let textResult = "";
            if (data.content && Array.isArray(data.content)) {
              const textContent = data.content.find((c: any) => c.type === "text");
              if (textContent) {
                textResult = textContent.text;
              }
            } else if (data.completion) {
              textResult = data.completion;
            }

            const inputTokens = data.usage?.input_tokens || 0;
            const outputTokens = data.usage?.output_tokens || 0;
            const cacheRead = data.usage?.cache_read_input_tokens || 0;
            const cacheWrite = data.usage?.cache_creation_input_tokens || 0;

            recordAiUsage({
              model,
              provider: "anthropic",
              inputTokens,
              outputTokens,
              cacheTokens: cacheRead,
              cacheWriteTokens: cacheWrite,
              requestStatus: "success",
              latencyMs: Date.now() - usageStartedAt,
              requestMetadata: data.usage,
            });

            // Return in OpenAI SDK format for compatibility
            return {
              choices: [
                {
                  message: {
                    content: textResult,
                    role: "assistant",
                  },
                  finish_reason: data.stop_reason || "stop",
                  index: 0,
                },
              ],
              usage: {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
                prompt_tokens_details: cacheRead
                  ? { cached_tokens: cacheRead }
                  : undefined,
              },
            };
          } catch (error) {
            console.error("[AI Client] Anthropic error:", error);
            throw error;
          }
        }

        // Fallback to OpenAI SDK
        const sdk = await getSdk();
        const toCompatBody = (
          request: any,
          useLegacyTokenParam: boolean,
          includeTemperature: boolean
        ) => {
          const body: Record<string, any> = { ...(request || {}) };
          if (promptCacheKey && !body.prompt_cache_key) {
            body.prompt_cache_key = promptCacheKey;
          }
          if (isNewAzureModel) {
            if (useLegacyTokenParam) {
              if (
                typeof body.max_completion_tokens === "number" &&
                typeof body.max_tokens !== "number"
              ) {
                body.max_tokens = body.max_completion_tokens;
              }
              delete body.max_completion_tokens;
            } else {
              if (
                typeof body.max_tokens === "number" &&
                typeof body.max_completion_tokens !== "number"
              ) {
                body.max_completion_tokens = body.max_tokens;
              }
              delete body.max_tokens;
            }

            if (includeTemperature) {
              body.temperature = 1;
            } else {
              delete body.temperature;
            }
          }
          return body;
        };

        const attempts = [
          toCompatBody(opts, false, true),
          toCompatBody(opts, true, true),
          toCompatBody(opts, false, false),
          toCompatBody(opts, true, false),
        ];

        let lastError: any;
        const usageStartedAt = Date.now();
        const modelNameForUsage =
          opts?.model ||
          process.env.AZURE_OPENAI_DEPLOYMENT ||
          process.env.OPENAI_MODEL ||
          "openai-default";
        for (const body of attempts) {
          try {
            const result = await sdk.chat.completions.create(body);
            const usage = (result as any)?.usage;
            if (usage) {
              const cached =
                usage.prompt_tokens_details?.cached_tokens ??
                usage.cached_tokens ??
                0;
              recordAiUsage({
                model: modelNameForUsage,
                provider: "openai",
                inputTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
                cacheTokens: cached,
                requestStatus: "success",
                latencyMs: Date.now() - usageStartedAt,
                requestMetadata: usage,
              });
            }
            return result;
          } catch (error: any) {
            lastError = error;
            const msg = String(error?.message || "").toLowerCase();
            const retryable =
              msg.includes("max_tokens") ||
              msg.includes("max_completion_tokens") ||
              msg.includes("temperature") ||
              msg.includes("unsupported parameter") ||
              msg.includes("unsupported value");
            if (!retryable) break;
          }
        }
        throw lastError;
      },
    },
  },
};

export default ai;

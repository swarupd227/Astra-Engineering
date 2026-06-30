import { Agent } from "undici";
import { AzureOpenAI } from "openai";
import { NEW_API_MODEL_SUBSTRINGS } from "../../llm-config-constants";
import { isAzureHosting } from "../hosting";
import { recordAiUsage } from "../../observability/ai-usage-recorder";
import {
  getEffectivePromptCacheTtl,
  isPromptCacheEnabled,
  resolvePromptCacheKey,
} from "../../observability/prompt-cache";

export const hasBedrock = false as const;

// Environment configuration check
const config = {
  AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION || "2024-02-01",
  AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,

  ANTHROPIC_AZURE_ENDPOINT: process.env.ANTHROPIC_AZURE_ENDPOINT,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL_NAME: process.env.ANTHROPIC_MODEL_NAME || "claude-3-5-sonnet-20241022",
  ANTHROPIC_MODEL_VERSION: process.env.ANTHROPIC_MODEL_VERSION || "2023-06-01",

  SELECTED_LLM: process.env.SELECTED_LLM || "ANTHROPIC",
};

const isValidAnthropicKey =
  !!config.ANTHROPIC_API_KEY && config.ANTHROPIC_API_KEY !== "your-anthropic-api-key";
// Direct Anthropic API (https://api.anthropic.com, x-api-key auth) is used when a
// valid key is present but no Azure-hosted Anthropic endpoint is configured.
export const anthropicDirectMode = isValidAnthropicKey && !config.ANTHROPIC_AZURE_ENDPOINT;
const anthropicEndpoint =
  config.ANTHROPIC_AZURE_ENDPOINT ||
  config.ANTHROPIC_BASE_URL ||
  "https://api.anthropic.com/v1/messages";

export const hasAzureOpenAI = !!(config.AZURE_OPENAI_API_KEY && config.AZURE_OPENAI_ENDPOINT);
export const hasAnthropic =
  isValidAnthropicKey && (!!config.ANTHROPIC_AZURE_ENDPOINT || anthropicDirectMode);

const AZURE_OPENAI_TIMEOUT_MS = 600000;

const ANTHROPIC_FETCH_DISPATCHER = new Agent({
  connectTimeout: 60_000,
  headersTimeout: AZURE_OPENAI_TIMEOUT_MS,
  bodyTimeout: AZURE_OPENAI_TIMEOUT_MS,
});
export const azureOpenAI = hasAzureOpenAI
  ? new AzureOpenAI({
      apiKey: config.AZURE_OPENAI_API_KEY!,
      endpoint: config.AZURE_OPENAI_ENDPOINT!,
      apiVersion: config.AZURE_OPENAI_API_VERSION,
      deployment: config.AZURE_OPENAI_DEPLOYMENT,
      timeout: AZURE_OPENAI_TIMEOUT_MS,
    })
  : null;

const WORKFLOW_INSTANCE_API_VERSION = process.env.WORKFLOW_INSTANCE_API_VERSION || "2024-12-01-preview";
function buildWorkflowInstances(): Array<{
  client: InstanceType<typeof AzureOpenAI>;
  deployment: string;
  name: string;
}> {
  const instances: Array<{
    client: InstanceType<typeof AzureOpenAI>;
    deployment: string;
    name: string;
  }> = [];
  for (let n = 1; n <= 10; n++) {
    const endpoint = process.env[`WORKFLOW_INSTANCE_${n}_ENDPOINT`];
    const apiKey = process.env[`WORKFLOW_INSTANCE_${n}_API_KEY`];
    const deployment = process.env[`WORKFLOW_INSTANCE_${n}_DEPLOYMENT`];
    if (endpoint && apiKey && deployment) {
      instances.push({
        client: new AzureOpenAI({
          apiKey,
          endpoint,
          apiVersion: WORKFLOW_INSTANCE_API_VERSION,
          deployment,
          timeout: AZURE_OPENAI_TIMEOUT_MS,
        }),
        deployment,
        name: `Instance_${n}`,
      });
    }
  }
  return instances;
}
export const workflowAzureInstances = buildWorkflowInstances();
export const hasWorkflowInstances = workflowAzureInstances.length > 0;
if (hasWorkflowInstances && isAzureHosting()) {
  console.log(
    "[LLM Config] Workflow multi-instance: using",
    workflowAzureInstances.length,
    "Azure deployment(s) for round-robin chunk distribution"
  );
}

class AnthropicClient {
  private endpoint: string;
  private apiKey: string;
  private modelName: string;
  private modelVersion: string;
  private direct: boolean;

  constructor(endpoint: string, apiKey: string, modelName: string, modelVersion: string, direct = false) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.modelVersion = modelVersion;
    this.direct = direct;
  }

  async createCompletion(params: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string | any[];
      cachePoint?: boolean;
    }>;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
  }) {
    const usageStartedAt = Date.now();
    const useCache = isPromptCacheEnabled();

    const toAnthropicContent = (content: string | any[], cache: boolean): any => {
      if (typeof content === "string") {
        if (cache && useCache) {
          return [{
            type: "text",
            text: content,
            cache_control: { type: "ephemeral", ttl: getEffectivePromptCacheTtl(this.modelName) },
          }];
        }
        return content;
      }
      if (!Array.isArray(content)) return content;
      return content.map((block: any) => {
        if (block?.type === "text" && cache && useCache && !block.cache_control) {
          return {
            ...block,
            cache_control: { type: "ephemeral", ttl: getEffectivePromptCacheTtl(this.modelName) },
          };
        }
        return block;
      });
    };

    // Native Anthropic Messages API expects `system` as a top-level field, not role "system" inside `messages`.
    const systemParts: any[] = [];
    const anthropicMessages: Array<{ role: "user" | "assistant"; content: any }> = [];
    for (const msg of params.messages) {
      if (msg.role === "system") {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block?.type === "text" && typeof block.text === "string") {
              if (msg.cachePoint && useCache && !block.cache_control) {
                systemParts.push({
                  type: "text",
                  text: block.text,
                  cache_control: { type: "ephemeral", ttl: getEffectivePromptCacheTtl(this.modelName) },
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
                cache_control: { type: "ephemeral", ttl: getEffectivePromptCacheTtl(this.modelName) },
              });
            } else {
              systemParts.push(text);
            }
          }
        }
        continue;
      }
      const cache = !!(msg as any).cachePoint;
      anthropicMessages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: toAnthropicContent(msg.content || "", cache),
      });
    }
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({ role: "user", content: "(no user message)" });
    }

    const ANTHROPIC_OUTPUT_HARD_CAP = 32000;
    const body: any = {
      model: this.modelName,
      messages: anthropicMessages,
      max_tokens: Math.min(params.max_tokens || 16000, ANTHROPIC_OUTPUT_HARD_CAP),
    };
    const joinedSystem = systemParts.filter(Boolean);
    if (joinedSystem.length === 1 && typeof joinedSystem[0] === "string") {
      body.system = joinedSystem[0];
    } else if (joinedSystem.length > 0) {
      body.system = joinedSystem;
    }

    if (typeof params.temperature !== "undefined") {
      body.temperature = params.temperature;
    }
    if (params.top_p) {
      body.top_p = params.top_p;
    }
    if (params.stop_sequences) {
      body.stop_sequences = params.stop_sequences;
    }

    let anthropicVersion = "2023-06-01";
    if (this.modelVersion.match(/^\d{4}-\d{2}-\d{2}$/)) {
      anthropicVersion = this.modelVersion;
    }

    console.log(`[Anthropic Client] Using API version: ${anthropicVersion} (original: ${this.modelVersion})`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": anthropicVersion,
    };
    if (this.direct) {
      // Direct Anthropic API authenticates with x-api-key, not Bearer.
      headers["x-api-key"] = this.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const maxAttempts = 3;
    const transientCodes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
    const isTransient = (err: unknown): boolean => {
      const e = err as { code?: string; cause?: { code?: string }; message?: string };
      const code = e?.code ?? e?.cause?.code;
      if (code && transientCodes.includes(code)) return true;
      if (e?.message === "fetch failed" && e?.cause) return true;
      return false;
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          // @ts-expect-error undici dispatcher
          dispatcher: ANTHROPIC_FETCH_DISPATCHER,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Anthropic request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();

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
          model: this.modelName,
          provider: "anthropic",
          inputTokens,
          outputTokens,
          cacheTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          requestStatus: "success",
          latencyMs: Date.now() - usageStartedAt,
          requestMetadata: data.usage,
        });

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
        lastError = error;
        if (attempt < maxAttempts && isTransient(error)) {
          const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
          console.warn(
            `[Anthropic Client] Transient error (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms:`,
            (error as Error).cause ?? (error as Error).message
          );
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          console.error("[Anthropic Client] Error:", error);
          throw error;
        }
      }
    }
    console.error("[Anthropic Client] Error:", lastError);
    throw lastError;
  }

  get chat() {
    return {
      completions: {
        create: this.createCompletion.bind(this),
      },
    };
  }
}

export const anthropic = hasAnthropic
  ? new AnthropicClient(
      anthropicEndpoint,
      config.ANTHROPIC_API_KEY!,
      config.ANTHROPIC_MODEL_NAME,
      config.ANTHROPIC_MODEL_VERSION,
      anthropicDirectMode
    )
  : null;

export function getSelectedLLM() {
  const selectedLLM = config.SELECTED_LLM.toUpperCase();
  const log = isAzureHosting() ? console.log.bind(console) : () => {};

  if (selectedLLM === "ANTHROPIC" && hasAnthropic) {
    log("[LLM Config] Using selected LLM: Anthropic (Claude)");
    return anthropic;
  }

  if (selectedLLM === "AZURE_OPENAI" && hasAzureOpenAI) {
    log("[LLM Config] Using selected LLM: Azure OpenAI");
    return azureOpenAI;
  }

  if (hasAnthropic) {
    log("[LLM Config] Selected LLM not available, falling back to Anthropic");
    return anthropic;
  }

  if (hasAzureOpenAI) {
    log("[LLM Config] Selected LLM not available, falling back to Azure OpenAI");
    return azureOpenAI;
  }

  if (!isAzureHosting()) return null;

  throw new Error(
    `No LLM available. Selected: ${selectedLLM}, Available: ${hasAnthropic ? "Anthropic" : ""} ${hasAzureOpenAI ? "Azure OpenAI" : ""}`
  );
}

// `getSelectedLLM()` throws when no Azure/Anthropic config is present AND
// `DEVX_HOSTING` defaults to "azure" (e.g. inside a Docker build container
// where `.env` is excluded and no LLM keys are wired as build ARGs). The
// `npm run build:smoketest` step loads the bundle at module level, so an
// unguarded throw here breaks every CI build for AWS deployments — even
// though the live AWS pod gets its config from Secrets Manager at runtime
// and never actually uses `azure-impl.LLM`. Make the module-load value
// tolerant; runtime callers (`llm.selected.chat.completions.create`) still
// invoke `getSelectedLLM()` themselves and surface real errors on the
// request path.
export const LLM = (() => {
  try {
    return getSelectedLLM();
  } catch (err) {
    console.warn(
      "[LLM Config] No Azure/Anthropic LLM configured at module-load; " +
        "deferring resolution to first request. This is expected in CI " +
        "build containers and on AWS pods (which use Bedrock).",
      (err as Error).message,
    );
    return null;
  }
})();

export const llm = {
  selected: {
    chat: {
      completions: {
        create: async (params: any) => {
          const promptCacheKey = resolvePromptCacheKey(params?.prompt_cache_key);
          const normalizedParams = promptCacheKey
            ? { ...params, prompt_cache_key: params?.prompt_cache_key ?? promptCacheKey }
            : params;
          const client = getSelectedLLM();
          if (!client) {
            throw new Error("No LLM client available");
          }

          if (client === azureOpenAI && hasAzureOpenAI) {
            const deploymentName = (config.AZURE_OPENAI_DEPLOYMENT || "").toLowerCase();
            const isNewAzureModel = NEW_API_MODEL_SUBSTRINGS.some((substr) =>
              deploymentName.includes(substr.toLowerCase())
            );

            if (isNewAzureModel) {
              const modifiedParams = { ...normalizedParams };
              if (
                typeof modifiedParams.max_tokens === "number" &&
                typeof modifiedParams.max_completion_tokens !== "number"
              ) {
                modifiedParams.max_completion_tokens = modifiedParams.max_tokens;
                delete modifiedParams.max_tokens;
              }
              modifiedParams.temperature = 1;
              return client.chat.completions.create(modifiedParams);
            }
          }

          return client.chat.completions.create(normalizedParams);
        },
      },
    },
  },

  azureOpenAI: {
    chat: {
      completions: {
        create: async (params: any) => {
          if (!hasAzureOpenAI || !azureOpenAI) {
            throw new Error("Azure OpenAI not configured");
          }
          return azureOpenAI.chat.completions.create(params);
        },
      },
    },
  },

  anthropic: {
    chat: {
      completions: {
        create: async (params: any) => {
          if (!hasAnthropic || !anthropic) {
            throw new Error("Anthropic not configured");
          }
          return anthropic.chat.completions.create(params);
        },
      },
    },
  },
};

export const bedrockEmbeddingClient = null;

export const llmConfig = {
  hasAzureOpenAI,
  hasAnthropic,
  selectedLLM: config.SELECTED_LLM,
  availableLLMs: [
    ...(hasAzureOpenAI ? ["Azure OpenAI"] : []),
    ...(hasAnthropic ? ["Anthropic"] : []),
  ],
  activeLLM:
    hasAnthropic && config.SELECTED_LLM.toUpperCase() === "ANTHROPIC"
      ? "Anthropic"
      : hasAzureOpenAI && config.SELECTED_LLM.toUpperCase() === "AZURE_OPENAI"
        ? "Azure OpenAI"
        : hasAnthropic
          ? "Anthropic (fallback)"
          : hasAzureOpenAI
            ? "Azure OpenAI (fallback)"
            : "None",
  anthropicModel: config.ANTHROPIC_MODEL_NAME,
  anthropicVersion: config.ANTHROPIC_MODEL_VERSION,
  azureOpenAIDeployment: config.AZURE_OPENAI_DEPLOYMENT,
};

if (isAzureHosting()) {
  console.log("[LLM Config] Configuration loaded:", llmConfig);
  console.log("[LLM Config] Anthropic Model:", config.ANTHROPIC_MODEL_NAME);
  console.log("[LLM Config] Anthropic Version:", config.ANTHROPIC_MODEL_VERSION);
}

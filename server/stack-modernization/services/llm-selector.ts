/**
 * Stack Modernization - LLM Selection Service
 *
 * Only two models are deployed in Azure AI Foundry:
 *   1. GPT-5.4  (Azure OpenAI — deployment from AZURE_OPENAI_DEPLOYMENT env)
 *   2. Claude Opus 4.1 (Anthropic via Azure)
 */

import type { LLMProvider } from "../types";
import {
  azureOpenAI,
  anthropic,
  hasAzureOpenAI,
  hasAnthropic,
  hasBedrock,
  getSelectedLLM,
} from "../../llm-config";
import {
  GPT_MODEL_ID,
  CLAUDE_MODEL_ID,
  GPT_DEPLOYMENT_FALLBACK,
  SUPPORTED_LLM_PROVIDERS,
  DEFAULT_MODEL_ID,
} from "../../llm-config-constants";

function getAzureDeployment(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT || GPT_DEPLOYMENT_FALLBACK;
}

const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-6-v1";

/**
 * Get LLM client based on user selection.
 */
export function getLLMClient(provider: string) {
  if (hasBedrock) {
    const client = getSelectedLLM();
    return {
      client,
      model: BEDROCK_MODEL_ID,
      provider: "bedrock" as const,
    };
  }

  // Anthropic Claude Opus 4.1
  if (provider === "claude-opus-4-1") {
    if (!hasAnthropic || !anthropic) {
      console.warn(`[LLM Selector] claude-opus-4-1 requested but Anthropic not configured, falling back to Azure OpenAI`);
      if (hasAzureOpenAI && azureOpenAI) {
        return {
          client: azureOpenAI,
          model: getAzureDeployment(),
          provider: "azure-openai" as const
        };
      }
      throw new Error("claude-opus-4-1 not configured and no fallback available");
    }

    return {
      client: anthropic,
      model: "claude-opus-4-1",
      provider: "anthropic" as const
    };
  }

  // Azure OpenAI GPT (any gpt-* selection)
  if (provider === GPT_MODEL_ID || provider.startsWith("gpt-")) {
    if (!hasAzureOpenAI || !azureOpenAI) {
      console.warn(`[LLM Selector] ${provider} requested but Azure OpenAI not configured, falling back to Anthropic`);
      if (hasAnthropic && anthropic) {
        return {
          client: anthropic,
          model: "claude-opus-4-1",
          provider: "anthropic" as const
        };
      }
      throw new Error(`${provider} not configured and no fallback available`);
    }

    return {
      client: azureOpenAI,
      model: getAzureDeployment(),
      provider: "azure-openai" as const
    };
  }

  // Fallback for unknown provider strings
  console.warn(`[LLM Selector] Unknown provider "${provider}", using default`);
  if (hasAzureOpenAI && azureOpenAI) {
    return {
      client: azureOpenAI,
      model: getAzureDeployment(),
      provider: "azure-openai" as const
    };
  }
  if (hasAnthropic && anthropic) {
    return {
      client: anthropic,
      model: "claude-opus-4-1",
      provider: "anthropic" as const
    };
  }

  throw new Error(`No LLM provider configured for: ${provider}`);
}

/**
 * Get available LLM options for frontend
 */
export function getAvailableLLMs() {
  if (hasBedrock) {
    return [
      {
        value: "bedrock" as LLMProvider,
        label: "Bedrock (Claude)",
        description: "Amazon Bedrock hosted Claude model",
        available: true,
      },
    ];
  }

  const available: Array<{ value: LLMProvider; label: string; description: string; available: boolean }> = [
    {
      value: GPT_MODEL_ID as LLMProvider,
      label: `GPT-${GPT_MODEL_ID.replace("gpt-", "")}`,
      description: "Latest & most capable GPT model",
      available: hasAzureOpenAI,
    },
    {
      value: CLAUDE_MODEL_ID as LLMProvider,
      label: "Claude Opus 4.1",
      description: "Most capable Anthropic model",
      available: hasAnthropic,
    },
  ];

  return available;
}

/**
 * Get default LLM provider
 */
export function getDefaultLLM(): LLMProvider {
  if (hasBedrock) return "bedrock" as LLMProvider;
  if (hasAzureOpenAI) return GPT_MODEL_ID as LLMProvider;
  if (hasAnthropic) return "claude-opus-4-1";
  throw new Error("No LLM provider configured");
}

/**
 * Get the fallback provider for a given primary provider.
 * Uses LLM_FALLBACK_PROVIDER env var if set, otherwise the other available provider.
 */
export function getFallbackProvider(primaryProvider: string): string | null {
  if (hasBedrock) return null;

  const envFallback = process.env.LLM_FALLBACK_PROVIDER;
  if (envFallback) return envFallback;

  if (primaryProvider === GPT_MODEL_ID || primaryProvider.startsWith("gpt-")) {
    return hasAnthropic ? CLAUDE_MODEL_ID : null;
  }
  if (primaryProvider === CLAUDE_MODEL_ID) {
    return hasAzureOpenAI ? GPT_MODEL_ID : null;
  }
  return null;
}

/**
 * Get LLM client with automatic fallback on failure.
 * Tries the primary provider first; on 500/timeout/rate-limit errors,
 * automatically falls back to the secondary provider.
 */
export function getLLMClientWithFallback(primaryProvider: string): {
  client: any;
  model: string;
  provider: string;
  isFallback: boolean;
  fallbackProvider: string | null;
} {
  const fallbackProvider = getFallbackProvider(primaryProvider);

  try {
    const primary = getLLMClient(primaryProvider);
    return {
      ...primary,
      isFallback: false,
      fallbackProvider,
    };
  } catch {
    if (fallbackProvider) {
      console.warn(`[LLM Selector] Primary provider ${primaryProvider} failed, using fallback ${fallbackProvider}`);
      const fallback = getLLMClient(fallbackProvider);
      return {
        ...fallback,
        isFallback: true,
        fallbackProvider: null,
      };
    }
    throw new Error(`Primary provider ${primaryProvider} failed and no fallback available`);
  }
}

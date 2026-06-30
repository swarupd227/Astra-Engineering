/**
 * Prompt assembly for provider prompt caching.
 *
 * Static content (system + first user block) must be byte-identical across
 * calls within a job so OpenAI/Azure automatic caching and Anthropic/Bedrock
 * explicit cache markers can reuse tokens. Dynamic content (dates, per-pass
 * instructions) belongs in the final user message only.
 */
import { createHash } from "node:crypto";
import { getAiContext } from "./ai-context";

export type PromptCacheProvider = "bedrock" | "anthropic" | "openai";

export type CachedMessageRole = "system" | "user" | "assistant";

export type CachedMessageContent =
  | string
  | Array<
      | { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } }
      | { type: string; [key: string]: unknown }
    >;

export interface CachedMessage {
  role: CachedMessageRole;
  content: CachedMessageContent;
  /** Bedrock Converse: mark this block as a cache breakpoint (static prefix). */
  cachePoint?: boolean;
}

export interface BuildCachedMessagesInput {
  staticSystem: string;
  staticUser: string;
  dynamicUser: string;
  provider?: PromptCacheProvider;
  /** Extra user/assistant turns after the static+dynamic pair (e.g. conversation). */
  trailingMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface CachedPrompt {
  messages: CachedMessage[];
  cacheFingerprint: string;
  staticPrefixTokenEstimate: number;
}

export function isPromptCacheEnabled(): boolean {
  const v = process.env.DEVX_PROMPT_CACHE;
  if (v === "0" || v === "false") return false;
  return true;
}

/** Rough token estimate (~4 chars/token) for metrics only. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function getPromptCacheTtl(): "5m" | "1h" {
  const raw = String(process.env.DEVX_PROMPT_CACHE_TTL || "5m").trim().toLowerCase();
  if (raw === "1h") return "1h";
  return "5m";
}

export function modelSupportsExtendedPromptCacheTtl(modelName: string): boolean {
  const m = String(modelName || "").toLowerCase();
  return (
    m.includes("claude-opus-4-5") ||
    m.includes("claude-opus-4-6") ||
    m.includes("claude-sonnet-4-5") ||
    m.includes("claude-sonnet-4-6") ||
    m.includes("claude-haiku-4-5")
  );
}

export function getEffectivePromptCacheTtl(modelName?: string): "5m" | "1h" {
  const requested = getPromptCacheTtl();
  if (requested !== "1h") return "5m";
  if (!modelName || modelSupportsExtendedPromptCacheTtl(modelName)) return "1h";
  console.warn(
    `[Prompt Cache] DEVX_PROMPT_CACHE_TTL=1h ignored for unsupported model=${modelName}; using 5m`,
  );
  return "5m";
}

export function resolvePromptCacheKey(explicit?: string): string | undefined {
  if (!isPromptCacheEnabled()) return undefined;
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const ctx = getAiContext();
  const fromContext = ctx?.correlationId?.trim() || ctx?.sessionId?.trim();
  return fromContext || undefined;
}

function fingerprint(staticSystem: string, staticUser: string): string {
  return createHash("sha256")
    .update(staticSystem)
    .update("\0")
    .update(staticUser)
    .digest("hex")
    .slice(0, 16);
}

function anthropicTextBlock(text: string, cache: boolean): CachedMessageContent {
  if (!cache || !isPromptCacheEnabled()) return text;
  return [{ type: "text", text, cache_control: { type: "ephemeral", ttl: getPromptCacheTtl() } }];
}

/**
 * Build a cache-friendly message list:
 *   system (static) → user (static) → user (dynamic) → [trailing...]
 */
export function buildCachedMessages(input: BuildCachedMessagesInput): CachedPrompt {
  const {
    staticSystem,
    staticUser,
    dynamicUser,
    provider = "openai",
    trailingMessages = [],
  } = input;

  const useExplicitCache =
    isPromptCacheEnabled() && (provider === "bedrock" || provider === "anthropic");

  const messages: CachedMessage[] = [];

  if (staticSystem.trim()) {
    messages.push({
      role: "system",
      content:
        provider === "anthropic"
          ? anthropicTextBlock(staticSystem, useExplicitCache)
          : staticSystem,
      cachePoint: useExplicitCache ? true : undefined,
    });
  }

  if (staticUser.trim()) {
    messages.push({
      role: "user",
      content:
        provider === "anthropic"
          ? anthropicTextBlock(staticUser, useExplicitCache)
          : staticUser,
      cachePoint: useExplicitCache ? true : undefined,
    });
  }

  if (dynamicUser.trim()) {
    messages.push({
      role: "user",
      content: dynamicUser,
    });
  }

  for (const msg of trailingMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return {
    messages,
    cacheFingerprint: fingerprint(staticSystem, staticUser),
    staticPrefixTokenEstimate:
      estimateTokens(staticSystem) + estimateTokens(staticUser),
  };
}

/** Window conversation history to the last N turns (user+assistant pairs). */
export function windowConversationHistory<T extends { role: string; content: string }>(
  history: T[],
  maxTurns = 10,
): T[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const maxMessages = maxTurns * 2;
  if (history.length <= maxMessages) return history;
  return history.slice(-maxMessages);
}

/** Normalize cache read/write counters from provider usage payloads. */
export function extractProviderCacheUsage(
  usage?: Record<string, unknown> | null,
  requestMetadata?: Record<string, unknown> | null,
): { cacheRead: number; cacheWrite: number } {
  const u = usage ?? {};
  const m = requestMetadata ?? {};
  const promptTokenDetails = (m as any).prompt_tokens_details;
  const read =
    Number(u.cacheReadInputTokens) ||
    Number(u.cacheReadInputTokenCount) ||
    Number(u.cache_read_input_tokens) ||
    Number(m.cacheReadInputTokens) ||
    Number(m.cache_read_input_tokens) ||
    Number(promptTokenDetails?.cached_tokens) ||
    0;
  const write =
    Number(u.cacheWriteInputTokens) ||
    Number(u.cacheWriteInputTokenCount) ||
    Number(u.cache_creation_input_tokens) ||
    Number(m.cacheWriteInputTokens) ||
    Number(m.cache_creation_input_tokens) ||
    0;
  return {
    cacheRead: Number.isFinite(read) ? Math.max(0, Math.floor(read)) : 0,
    cacheWrite: Number.isFinite(write) ? Math.max(0, Math.floor(write)) : 0,
  };
}

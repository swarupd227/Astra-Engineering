/**
 * recordAiUsage — the single sink that writes one row to universal_ai_usage_logs
 * for every Bedrock call (generation + embedding). Called from the Bedrock
 * chokepoint in platform/llm/bedrock-impl.ts.
 *
 * - Reads request attribution from the AsyncLocalStorage AI context.
 * - Honors `skipLogging` (code-generation surfaces) by doing nothing.
 * - Resolves cache tokens, computes cost from the static price map.
 * - Fire-and-forget: never throws, never blocks the LLM response.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { universalAiUsageLogs } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getAiContext } from "./ai-context";
import { computeCostUsd, computeCacheSavingsUsd } from "./ai-pricing";
import { extractProviderCacheUsage } from "./prompt-cache";

/** Log per-call token + cache usage (default on; set DEVX_AI_USAGE_LOG=0 to disable). */
export function isAiUsageLogEnabled(): boolean {
  const v = process.env.DEVX_AI_USAGE_LOG;
  if (v === "0" || v === "false") return false;
  return true;
}

function formatCacheHitPct(cacheTokens: number, inputTokens: number, totalTokens: number): string {
  const denom = inputTokens + cacheTokens;
  if (denom <= 0) return "0.0";
  return ((cacheTokens / denom) * 100).toFixed(1);
}

function logAiUsageEvent(row: {
  featureName: string;
  useCase: string | null;
  provider: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: string;
  latencyMs: number | null;
  correlationId: string | null;
  requestStatus: string;
}): void {
  if (!isAiUsageLogEnabled()) return;

  const cacheSavedUsd = computeCacheSavingsUsd({
    model: row.modelName,
    cacheTokens: row.cacheTokens,
  });
  const cacheHitPct = formatCacheHitPct(row.cacheTokens, row.inputTokens, row.totalTokens);

  const parts = [
    `[AI Usage]`,
    `feature=${row.featureName}`,
    row.useCase ? `useCase=${row.useCase}` : null,
    `provider=${row.provider}`,
    `model=${row.modelName}`,
    `input=${row.inputTokens}`,
    `output=${row.outputTokens}`,
    `cached_read=${row.cacheTokens}`,
    row.cacheWriteTokens > 0 ? `cached_write=${row.cacheWriteTokens}` : null,
    `total=${row.totalTokens}`,
    row.cacheTokens > 0 ? `cache_hit=${cacheHitPct}%` : null,
    `cost_usd=${row.costUsd}`,
    cacheSavedUsd > 0 ? `cache_saved_usd=${cacheSavedUsd.toFixed(6)}` : null,
    row.latencyMs != null ? `latency_ms=${row.latencyMs}` : null,
    row.correlationId ? `correlationId=${row.correlationId}` : null,
    `status=${row.requestStatus}`,
  ].filter(Boolean);

  console.log(parts.join(" | "));
}

export interface RecordAiUsageInput {
  model: string;
  provider?: string; // default 'claude'
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  cacheWriteTokens?: number;
  requestStatus?: "success" | "failed";
  feature?: string; // overrides ctx.feature
  useCase?: string; // overrides ctx.useCase
  latencyMs?: number;
  requestMetadata?: Record<string, any>;
  correlationId?: string;
}

function clampInt(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Cache read tokens from metadata (excludes cache write/creation). */
function resolveCacheTokens(explicit: number | undefined, meta?: Record<string, any>): number {
  if (explicit != null) return clampInt(explicit);
  if (!meta) return 0;
  if (meta.prompt_tokens_details?.cached_tokens != null) {
    return clampInt(meta.prompt_tokens_details.cached_tokens);
  }
  const read = meta.cacheReadInputTokens ?? meta.cache_read_input_tokens;
  if (read != null) return clampInt(read);
  return clampInt(meta.cacheTokens ?? meta.cache_tokens ?? meta.cached_tokens ?? 0);
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
}

/** Sum usage logged for a correlation id (e.g. BRD id) after generation completes. */
export async function sumUsageByCorrelationId(
  correlationId: string,
): Promise<UsageTotals> {
  if (!correlationId?.trim()) {
    return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, costUsd: 0 };
  }
  try {
    const [row] = await db
      .select({
        inputTokens: sql<number>`COALESCE(SUM(${universalAiUsageLogs.inputTokens}), 0)`,
        outputTokens: sql<number>`COALESCE(SUM(${universalAiUsageLogs.outputTokens}), 0)`,
        cacheTokens: sql<number>`COALESCE(SUM(${universalAiUsageLogs.cacheTokens}), 0)`,
        costUsd: sql<string>`COALESCE(SUM(${universalAiUsageLogs.costUsd}), 0)`,
      })
      .from(universalAiUsageLogs)
      .where(eq(universalAiUsageLogs.correlationId, correlationId));
    const inputTokens = Number(row?.inputTokens ?? 0);
    const outputTokens = Number(row?.outputTokens ?? 0);
    const cacheTokens = Number(row?.cacheTokens ?? 0);
    return {
      inputTokens,
      outputTokens,
      cacheTokens,
      totalTokens: inputTokens + outputTokens + cacheTokens,
      costUsd: Number(row?.costUsd ?? 0),
    };
  } catch (e) {
    console.error("[sumUsageByCorrelationId] query failed:", (e as Error)?.message || e);
    return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, costUsd: 0 };
  }
}

/** Log aggregated usage for a job (e.g. full BRD generation across passes). */
export function logUsageTotalsSummary(
  label: string,
  totals: UsageTotals,
  extra?: Record<string, string | number | undefined> & { model?: string },
): void {
  if (!isAiUsageLogEnabled()) return;

  const cacheHitPct = formatCacheHitPct(
    totals.cacheTokens,
    totals.inputTokens,
    totals.totalTokens,
  );
  const modelForSavings =
    extra?.model ||
    process.env.BEDROCK_MODEL_ID ||
    process.env.ANTHROPIC_MODEL_NAME ||
    "us.anthropic.claude-opus-4-6-v1";
  const cacheSavedUsd = computeCacheSavingsUsd({
    model: String(modelForSavings),
    cacheTokens: totals.cacheTokens,
  });
  const { model: _model, ...restExtra } = extra ?? {};
  const extras = Object.entries(restExtra)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" | ");

  console.log(
    `[AI Usage Summary] ${label} | input=${totals.inputTokens} | output=${totals.outputTokens} | cached_read=${totals.cacheTokens} | total=${totals.totalTokens} | cache_hit=${cacheHitPct}% | cost_usd=${totals.costUsd.toFixed(6)} | cache_saved_usd=${cacheSavedUsd.toFixed(6)}${extras ? ` | ${extras}` : ""}`,
  );
}

/**
 * Record one AI usage event. Fire-and-forget — call without await.
 */
export function recordAiUsage(input: RecordAiUsageInput): void {
  const ctx = getAiContext();

  // Code-generation (and any explicitly excluded surface) is not logged.
  if (ctx?.skipLogging) return;

  const inputTokens = clampInt(input.inputTokens);
  const outputTokens = clampInt(input.outputTokens);
  const meta = input.requestMetadata as Record<string, unknown> | undefined;
  const resolved = extractProviderCacheUsage(meta, meta);
  const cacheTokens =
    input.cacheTokens != null ? clampInt(input.cacheTokens) : Math.max(resolved.cacheRead, resolveCacheTokens(undefined, input.requestMetadata));
  const cacheWriteTokens =
    input.cacheWriteTokens != null ? clampInt(input.cacheWriteTokens) : resolved.cacheWrite;
  const totalTokens = inputTokens + outputTokens + cacheTokens + cacheWriteTokens;
  const provider = input.provider ?? "claude";
  const cost = computeCostUsd({ model: input.model, inputTokens, outputTokens, cacheTokens });

  const row = {
    id: randomUUID(),
    userId: ctx?.userId ?? null,
    tenantId: ctx?.tenantId ?? null,
    teamId: null as string | null,
    projectId: ctx?.projectId ?? null,
    sessionId: ctx?.sessionId ?? null,
    correlationId: input.correlationId ?? ctx?.correlationId ?? null,
    provider,
    modelName: input.model || "unknown",
    featureName: input.feature ?? ctx?.feature ?? "unknown",
    useCase: input.useCase ?? ctx?.useCase ?? null,
    requestStatus: input.requestStatus ?? "success",
    qualityDecision: "unrated" as const,
    inputTokens,
    outputTokens,
    cacheTokens,
    totalTokens,
    costUsd: cost.toFixed(6),
    currency: "USD",
    latencyMs: input.latencyMs ?? null,
    requestMetadata: {
      ...(input.requestMetadata ?? {}),
      cacheWriteInputTokens: cacheWriteTokens,
    },
  };

  logAiUsageEvent({
    featureName: row.featureName,
    useCase: row.useCase,
    provider,
    modelName: row.modelName,
    inputTokens,
    outputTokens,
    cacheTokens,
    cacheWriteTokens,
    totalTokens,
    costUsd: row.costUsd,
    latencyMs: row.latencyMs,
    correlationId: row.correlationId,
    requestStatus: row.requestStatus,
  });

  // Fire-and-forget insert.
  Promise.resolve()
    .then(() => db.insert(universalAiUsageLogs).values(row))
    .catch((e) => console.error("[recordAiUsage] insert failed:", e?.message || e));
}

/**
 * Workflow / artifact generation LLM usage — cache-aware logging and instance pinning.
 */
import { hasBedrock } from "../llm-config";
import { computeCacheSavingsUsd, computeCostUsd } from "./ai-pricing";
import { recordAiUsage } from "./ai-usage-recorder";
import { extractProviderCacheUsage, isPromptCacheEnabled } from "./prompt-cache";

export function resolveWorkflowCacheInstanceIndex(
  chunkIndex: number,
  totalInstances: number,
): number | undefined {
  if (totalInstances <= 0) return undefined;
  if (isPromptCacheEnabled() && totalInstances > 1) {
    const raw = parseInt(process.env.WORKFLOW_CACHE_INSTANCE_INDEX || "0", 10);
    const pinned = Number.isFinite(raw) && raw >= 0 && raw < totalInstances ? raw : 0;
    return pinned;
  }
  return chunkIndex % totalInstances;
}

export interface WorkflowLlmUsageInput {
  model: string;
  provider: "azure" | "anthropic";
  usage?: Record<string, unknown> | null;
  latencyMs?: number;
  callId?: string;
  useCase?: string;
  correlationId?: string;
  label?: string;
}

export interface WorkflowLlmUsageResult {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

function readTokenCounts(usage: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
} {
  const inputTokens = Math.max(
    0,
    Math.floor(
      Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0) || 0,
    ),
  );
  const outputTokens = Math.max(
    0,
    Math.floor(
      Number(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0) || 0,
    ),
  );
  const { cacheRead, cacheWrite } = extractProviderCacheUsage(usage);
  return { inputTokens, outputTokens, cacheRead, cacheWrite };
}

/** Record artifact/workflow LLM usage + emit per-call cache debug line. */
export function recordWorkflowLlmUsage(input: WorkflowLlmUsageInput): WorkflowLlmUsageResult {
  const usage = (input.usage ?? {}) as Record<string, unknown>;
  const { inputTokens, outputTokens, cacheRead, cacheWrite } = readTokenCounts(usage);
  const costUsd = computeCostUsd({
    model: input.model,
    inputTokens,
    outputTokens,
    cacheTokens: cacheRead,
  });

  // Bedrock client already calls recordAiUsage; withAiContext supplies feature/useCase/correlationId.
  if (!hasBedrock) {
    recordAiUsage({
      model: input.model,
      provider: input.provider === "anthropic" ? "anthropic" : "azure",
      inputTokens,
      outputTokens,
      cacheTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      feature: "workflow",
      useCase: input.useCase ?? "artifact generation",
      latencyMs: input.latencyMs,
      correlationId: input.correlationId,
      requestMetadata: usage,
    });
  }

  if (isPromptCacheEnabled() && (cacheRead > 0 || cacheWrite > 0 || input.label)) {
    const cacheSavedUsd = computeCacheSavingsUsd({ model: input.model, cacheTokens: cacheRead });
    const prefix = input.label ? `[Prompt Cache] ${input.label}` : "[Prompt Cache]";
    console.log(
      `${prefix} feature=workflow useCase=${input.useCase ?? "artifact generation"} correlationId=${input.correlationId ?? "n/a"} cached_read=${cacheRead} cached_write=${cacheWrite} cache_saved_usd=${cacheSavedUsd.toFixed(6)}`,
    );
  }

  return {
    inputTokens,
    outputTokens,
    cacheTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd,
  };
}

/**
 * Centralized LLM Call Tracker
 *
 * Wraps every client.chat.completions.create() call to capture:
 *   - Input / output token counts (from response.usage or heuristic)
 *   - Wall-clock duration
 *   - Estimated cost (per-model pricing table)
 *
 * Accumulates metrics per-phase in state.tokenUsage via stateStore.
 */

import { stateStore } from "./state-store";
import { estimateTokens, normalizeRequestParams } from "./token-manager";
import { withAiContext } from "../../observability/ai-context";
import type { PhaseMetrics, AgentMetrics, TokenUsageSummary } from "../types";
import { MODEL_COST_MAP, DEFAULT_MODEL_ID } from "../../llm-config-constants";

// Per-1K-token pricing comes from the central config — edit llm-config-constants.ts to update.
const MODEL_COST_TABLE = MODEL_COST_MAP;

function getCostPer1K(model: string): { input: number; output: number } {
  for (const [key, cost] of Object.entries(MODEL_COST_TABLE)) {
    if (model.includes(key) || key.includes(model)) return cost;
  }
  return MODEL_COST_TABLE[DEFAULT_MODEL_ID];
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = getCostPer1K(model);
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

export interface TrackedLLMContext {
  analysisId: string;
  phase: string;
  agent: string;
  /** Provider that was actually used for this call (set by fallback logic) */
  actualProvider?: string;
}

/**
 * Drop-in replacement for `client.chat.completions.create()`.
 * Returns the original ChatCompletion unchanged; side-effect: accumulates metrics.
 * Accepts `any` for client/params to support both OpenAI and Anthropic clients.
 *
 * If an Azure content filter error is returned, the wrapper automatically
 * sanitizes the prompt messages and retries (standard → aggressive).
 */
export async function trackedLLMCall(
  client: any,
  params: any,
  context: TrackedLLMContext,
): Promise<any> {
  const { sanitizeMessages, isContentFilterError } = await import("./prompt-sanitizer");

  let currentParams = normalizeRequestParams(params);
  const MAX_FILTER_RETRIES = 2;

  for (let filterAttempt = 0; filterAttempt <= MAX_FILTER_RETRIES; filterAttempt++) {
    const startTime = Date.now();
    try {
      const response = await withAiContext(
        { feature: "stack_modernization", useCase: "stack modernization" },
        () => client.chat.completions.create(currentParams),
      );
      const durationMs = Date.now() - startTime;

      let inputTokens = response.usage?.prompt_tokens ?? 0;
      let outputTokens = response.usage?.completion_tokens ?? 0;

      if (inputTokens === 0 && currentParams.messages) {
        const text = currentParams.messages.map((m: any) => (typeof m.content === "string" ? m.content : "")).join(" ");
        inputTokens = estimateTokens(text);
      }
      if (outputTokens === 0) {
        const content = response.choices?.[0]?.message?.content ?? "";
        outputTokens = estimateTokens(content);
      }

      const totalTokens = inputTokens + outputTokens;
      const model = currentParams.model ?? "unknown";
      const estimatedCost = computeCost(model, inputTokens, outputTokens);

      accumulateMetrics(context, {
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        estimatedCost,
      });

      const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
      const providerTag = context.actualProvider ? ` [${context.actualProvider}]` : "";
      console.log(
        `[TokenTracker] ${context.phase}/${context.agent}${providerTag}: ` +
        `${fmtTokens(inputTokens)} in + ${fmtTokens(outputTokens)} out = ${fmtTokens(totalTokens)} tokens ` +
        `($${estimatedCost.toFixed(4)}) in ${(durationMs / 1000).toFixed(1)}s`,
      );

      return response;
    } catch (err: any) {
      if (isContentFilterError(err) && filterAttempt < MAX_FILTER_RETRIES && currentParams.messages) {
        const level = filterAttempt === 0 ? "standard" : "aggressive";

        // Diagnostic: log a snippet of each message to help identify the trigger
        if (filterAttempt === 0) {
          for (const m of currentParams.messages) {
            const text = typeof m.content === "string" ? m.content : "";
            const suspiciousHex = (text.match(/[0-9A-Fa-f]{40,}/g) || []).length;
            const suspiciousB64 = (text.match(/[A-Za-z0-9+/]{40,}={0,3}/g) || []).length;
            const nonPrintable = (text.match(/[\x00-\x08\x0E-\x1F\x7F]/g) || []).length;
            console.warn(
              `[TokenTracker] ContentFilter diag — role=${m.role}, len=${text.length}, ` +
              `hexBlobs=${suspiciousHex}, b64Blobs=${suspiciousB64}, nonPrintableChars=${nonPrintable}`,
            );
          }
        }

        console.warn(
          `[TokenTracker] Content filter triggered for ${context.phase}/${context.agent} ` +
          `(retry ${filterAttempt + 1}/${MAX_FILTER_RETRIES}), sanitizing at level="${level}"...`,
        );
        currentParams = {
          ...currentParams,
          messages: sanitizeMessages(currentParams.messages, level as any),
        };
        continue;
      }
      throw err;
    }
  }

  throw new Error("trackedLLMCall: exhausted content-filter retries");
}

function emptyPhaseMetrics(phase: string): PhaseMetrics {
  return {
    phase,
    durationMs: 0,
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
}

function initUsageIfNeeded(state: any): TokenUsageSummary {
  if (!state.tokenUsage) {
    state.tokenUsage = {
      phases: {},
      agents: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalLLMCalls: 0,
      totalEstimatedCost: 0,
      totalDurationMs: 0,
    };
  }
  if (!state.tokenUsage.agents) {
    state.tokenUsage.agents = {};
  }
  return state.tokenUsage;
}

function accumulateMetrics(
  context: TrackedLLMContext,
  metrics: { inputTokens: number; outputTokens: number; totalTokens: number; durationMs: number; estimatedCost: number },
): void {
  const state = stateStore.get(context.analysisId);
  if (!state) return;

  const usage = initUsageIfNeeded(state);

  if (!usage.phases[context.phase]) {
    usage.phases[context.phase] = emptyPhaseMetrics(context.phase);
  }

  const pm = usage.phases[context.phase];
  pm.llmCalls += 1;
  pm.inputTokens += metrics.inputTokens;
  pm.outputTokens += metrics.outputTokens;
  pm.totalTokens += metrics.totalTokens;
  pm.durationMs += metrics.durationMs;
  pm.estimatedCost += metrics.estimatedCost;

  // Per-agent tracking
  const agentKey = `${context.phase}/${context.agent}`;
  if (!usage.agents[agentKey]) {
    usage.agents[agentKey] = {
      agent: context.agent,
      phase: context.phase,
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      estimatedCost: 0,
    };
  }
  const am = usage.agents[agentKey];
  am.llmCalls += 1;
  am.inputTokens += metrics.inputTokens;
  am.outputTokens += metrics.outputTokens;
  am.totalTokens += metrics.totalTokens;
  am.durationMs += metrics.durationMs;
  am.estimatedCost += metrics.estimatedCost;

  usage.totalInputTokens += metrics.inputTokens;
  usage.totalOutputTokens += metrics.outputTokens;
  usage.totalTokens += metrics.totalTokens;
  usage.totalLLMCalls += 1;
  usage.totalEstimatedCost += metrics.estimatedCost;
  usage.totalDurationMs += metrics.durationMs;

  stateStore.save(state);
}

/** Mark a phase as started (records wall-clock start timestamp). */
export function recordPhaseStart(analysisId: string, phase: string): void {
  const state = stateStore.get(analysisId);
  if (!state) return;

  const usage = initUsageIfNeeded(state);
  if (!usage.phases[phase]) {
    usage.phases[phase] = emptyPhaseMetrics(phase);
  }
  usage.phases[phase].startedAt = Date.now();
  stateStore.save(state);
}

/** Mark a phase as completed (records wall-clock end timestamp + total duration). */
export function recordPhaseEnd(analysisId: string, phase: string): void {
  const state = stateStore.get(analysisId);
  if (!state?.tokenUsage?.phases[phase]) return;

  const pm = state.tokenUsage.phases[phase];
  pm.completedAt = Date.now();
  if (pm.startedAt) {
    pm.durationMs = pm.completedAt - pm.startedAt;
  }
  stateStore.save(state);
}

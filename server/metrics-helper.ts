import { db } from "./db";
import { artifactEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { setAiContext } from "./observability/ai-context";

/**
 * Resolve AI-usage attribution for universal_ai_usage_logs.
 *
 * feature_name = the SCREEN/module that triggered the call; use_case = the ACTION
 * (which drives the Polaris use_cases buckets in ai-metrics-service). Callers may
 * pass an explicit `feature` (e.g. the Super-Agent chat passes 'bot'); otherwise
 * trackEventStart-driven actions default to the Backlog/Workflow screen.
 *
 * Code generation is flagged skipLogging so it is NOT captured (per requirement).
 */
function aiContextForUseCase(useCase: string, featureOverride?: string): {
  feature: string;
  useCase: string;
  skipLogging?: boolean;
} {
  const u = (useCase || "").toLowerCase();
  if (u.includes("code generation")) {
    return { feature: featureOverride ?? "code_generation", useCase, skipLogging: true };
  }
  // Default screen for trackEventStart actions (artifact generation, bug
  // detection, workflow conversation, etc.) is the Backlog/Workflow module.
  return { feature: featureOverride ?? "backlog_workflow", useCase };
}

/**
 * Starts tracking an artifact event.
 * Returns a unique metricId and the current timestamp for duration calculation.
 */
export async function trackEventStart(params: {
  artifactId: string;
  useCase: string;
  userId?: string | number;
  projectId?: string | number;
  feature?: string; // optional screen/module override (e.g. 'bot' for Super-Agent chat)
}) {
  const metricId = randomUUID();
  const startTime = Date.now();

  // Resolve the project to our sdlc_projects.id so attribution is consistent
  // with every other surface (project-wise team metrics).
  let resolvedProjectId: string | undefined;
  if (params.projectId != null && String(params.projectId).trim()) {
    const raw = String(params.projectId).trim();
    try {
      const { resolveSdlcProjectId } = await import("./observability/ai-context");
      resolvedProjectId = (await resolveSdlcProjectId(raw)) ?? raw;
    } catch {
      resolvedProjectId = raw;
    }
  }

  // Attribute the downstream AI call(s) in this request context for
  // universal_ai_usage_logs (sets feature/use_case; flags code-gen skipLogging).
  setAiContext({
    ...aiContextForUseCase(params.useCase, params.feature),
    projectId: resolvedProjectId,
    // Link the usage row to the artifact so quality can be marked on save.
    correlationId: params.artifactId,
  });

  await db.insert(artifactEvents).values({
    id: metricId,
    artifactId: params.artifactId,
    useCase: params.useCase,
    status: "started",
    userId: params.userId?.toString(),
    projectId: params.projectId?.toString(),
    tokensUsed: 0,
    processingTimeMs: 0,
  }).catch(err => console.error(`[Metrics Error] ${params.useCase} Start:`, err));
  
  return { metricId, startTime };
}

/**
 * Updates an artifact event to "success" status.
 */
export async function trackEventSuccess(metricId: string, startTime: number, tokensUsed: number, artifactId?: string) {
  const duration = Date.now() - startTime;
  const updateData: any = {
    status: "success",
    tokensUsed,
    processingTimeMs: duration,
  };
  
  if (artifactId) {
    updateData.artifactId = artifactId;
  }

  await db.update(artifactEvents).set(updateData).where(eq(artifactEvents.id, metricId))
    .catch(err => console.error("[Metrics Error] Event Success:", err));
}

/**
 * Directly records a successful artifact event in a single call.
 * Useful for legacy code that only tracks success after completion.
 */
export async function trackEventSuccessOnly(params: {
  artifactId: string;
  useCase: string;
  userId?: string | number;
  projectId?: string | number;
  tokensUsed: number;
  processingTimeMs: number;
}) {
  await db.insert(artifactEvents).values({
    id: randomUUID(),
    artifactId: params.artifactId,
    useCase: params.useCase,
    status: "success",
    userId: params.userId?.toString(),
    projectId: params.projectId?.toString(),
    tokensUsed: params.tokensUsed,
    processingTimeMs: params.processingTimeMs,
  }).catch(err => console.error(`[Metrics Error] ${params.useCase} SuccessOnly:`, err));
}

/**
 * Updates an artifact event to "failed" status.
 */
export async function trackEventFailure(metricId: string, startTime: number) {
  const duration = Date.now() - startTime;
  await db.update(artifactEvents).set({
    status: "failed",
    processingTimeMs: duration,
  }).where(eq(artifactEvents.id, metricId))
    .catch(err => console.error("[Metrics Error] Event Failed:", err));
}

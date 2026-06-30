/**
 * AI output quality capture for universal_ai_usage_logs.quality_decision.
 *
 * Every usage row starts 'unrated'. These helpers flip it when the user acts on
 * the AI output:
 *   - accepted: saved/applied unchanged
 *   - modified: saved/applied after edits
 *   - rejected: discarded / generation failed
 *
 * Linking strategy (first that matches):
 *   1. correlationId  — usage rows set correlation_id = artifactId (via
 *      trackEventStart) or a surface-provided id. Most precise.
 *   2. recent unrated — newest 'unrated' row for the userId (optionally scoped by
 *      feature) within a short window. Fallback when no correlationId is plumbed.
 *
 * All updates are best-effort and never throw.
 */
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { universalAiUsageLogs } from "@shared/schema";

export type QualityDecision = "accepted" | "modified" | "rejected";

export interface MarkQualityOptions {
  correlationId?: string; // e.g. artifactId
  userId?: string;
  feature?: string;
  withinMinutes?: number; // recent-unrated fallback window (default 120)
}

async function markQuality(decision: QualityDecision, opts: MarkQualityOptions): Promise<number> {
  try {
    // 1) Precise: by correlationId (only rows still unrated).
    if (opts.correlationId) {
      const res: any = await db
        .update(universalAiUsageLogs)
        .set({ qualityDecision: decision })
        .where(
          and(
            eq(universalAiUsageLogs.correlationId, opts.correlationId),
            eq(universalAiUsageLogs.qualityDecision, "unrated"),
          ),
        );
      const affected = res?.[0]?.affectedRows ?? res?.affectedRows ?? 0;
      if (affected > 0) return affected;
    }

    // 2) Fallback: newest unrated row for this user (optionally feature-scoped).
    if (opts.userId) {
      const within = opts.withinMinutes ?? 120;
      const conds = [
        eq(universalAiUsageLogs.userId, opts.userId),
        eq(universalAiUsageLogs.qualityDecision, "unrated"),
        gt(universalAiUsageLogs.createdAt, sql`(NOW() - INTERVAL ${within} MINUTE)`),
      ];
      if (opts.feature) conds.push(eq(universalAiUsageLogs.featureName, opts.feature));
      const latest = await db
        .select({ id: universalAiUsageLogs.id })
        .from(universalAiUsageLogs)
        .where(and(...conds))
        .orderBy(desc(universalAiUsageLogs.createdAt))
        .limit(1);
      if (latest[0]) {
        await db
          .update(universalAiUsageLogs)
          .set({ qualityDecision: decision })
          .where(eq(universalAiUsageLogs.id, latest[0].id));
        return 1;
      }
    }
    return 0;
  } catch (e: any) {
    console.error(`[quality] markQuality(${decision}) failed:`, e?.message || e);
    return 0;
  }
}

export function markAccepted(opts: MarkQualityOptions): void {
  void markQuality("accepted", opts);
}
export function markModified(opts: MarkQualityOptions): void {
  void markQuality("modified", opts);
}
export function markRejected(opts: MarkQualityOptions): void {
  void markQuality("rejected", opts);
}

/** Await variant for tests / callers that need the affected count. */
export function markQualityAwait(decision: QualityDecision, opts: MarkQualityOptions): Promise<number> {
  return markQuality(decision, opts);
}

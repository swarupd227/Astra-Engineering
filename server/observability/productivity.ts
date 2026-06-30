/**
 * Productivity targets (target_saved_hours per period) for the Polaris metrics
 * endpoint. Admins seed a target per period; the aggregation reads it.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, getPool } from "../db";
import { productivityTargets } from "@shared/schema";

/** Read the target_saved_hours for an exact period window. Returns 0 if none. */
export async function getProductivityTarget(
  periodType: string,
  periodStart: string, // YYYY-MM-DD
  periodEnd: string, // YYYY-MM-DD
): Promise<number> {
  try {
    const rows = await db
      .select({ hours: productivityTargets.targetSavedHours })
      .from(productivityTargets)
      .where(
        and(
          eq(productivityTargets.periodType, periodType),
          eq(productivityTargets.periodStart, periodStart),
          eq(productivityTargets.periodEnd, periodEnd),
        ),
      )
      .limit(1);
    return rows[0] ? Number(rows[0].hours) : 0;
  } catch (e: any) {
    console.error("[productivity] getProductivityTarget failed:", e?.message || e);
    return 0;
  }
}

/** Upsert a target for a period (admin). */
export async function upsertProductivityTarget(params: {
  periodType: string;
  periodStart: string;
  periodEnd: string;
  targetSavedHours: number;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO productivity_targets (id, period_type, period_start, period_end, target_saved_hours, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE target_saved_hours = VALUES(target_saved_hours)`,
    [randomUUID(), params.periodType, params.periodStart, params.periodEnd, params.targetSavedHours],
  );
}

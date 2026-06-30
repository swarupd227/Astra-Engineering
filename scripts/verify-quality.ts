// Step 5 verification: quality_decision transitions via correlationId and the
// user-scoped recent-unrated fallback; decided rows are not overridden.
//
// Run:  npx tsx scripts/verify-quality.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "node:crypto";

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool, db } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();
  const { universalAiUsageLogs } = await import("@shared/schema");
  const { markQualityAwait } = await import("../server/observability/quality");
  const { eq } = await import("drizzle-orm");

  async function insertRow(extra: Record<string, any>): Promise<string> {
    const id = randomUUID();
    await db.insert(universalAiUsageLogs).values({
      id,
      provider: "claude",
      modelName: "test-model",
      requestStatus: "success",
      qualityDecision: "unrated",
      inputTokens: 1, outputTokens: 1, cacheTokens: 0, totalTokens: 2,
      costUsd: "0",
      ...extra,
    } as any);
    return id;
  }
  async function decisionOf(id: string): Promise<string> {
    const [r]: any = await pool.query(`SELECT quality_decision FROM universal_ai_usage_logs WHERE id=?`, [id]);
    return r[0]?.quality_decision;
  }

  let pass = 0, total = 0;
  const check = (n: string, c: boolean, e = "") => { total++; if (c) pass++; console.log(`${c ? "✓" : "✗"} ${n}${e ? ` — ${e}` : ""}`); };

  // 1) accepted by correlationId
  const a = await insertRow({ correlationId: "q-corr-A", userId: "q-user", featureName: "artifact" });
  const aAff = await markQualityAwait("accepted", { correlationId: "q-corr-A" });
  check("accepted via correlationId", aAff === 1 && (await decisionOf(a)) === "accepted");

  // 2) modified via user-scoped fallback
  const b = await insertRow({ userId: "q-user2", featureName: "workflow" });
  const bAff = await markQualityAwait("modified", { userId: "q-user2", feature: "workflow" });
  check("modified via user fallback", bAff === 1 && (await decisionOf(b)) === "modified");

  // 3) rejected by correlationId
  const c = await insertRow({ correlationId: "q-corr-C", userId: "q-user3" });
  await markQualityAwait("rejected", { correlationId: "q-corr-C" });
  check("rejected via correlationId", (await decisionOf(c)) === "rejected");

  // 4) untouched row stays unrated
  const d = await insertRow({ userId: "q-user-d" });
  check("untouched stays unrated", (await decisionOf(d)) === "unrated");

  // 5) decided row is NOT overridden (only 'unrated' rows are updated)
  const overAff = await markQualityAwait("rejected", { correlationId: "q-corr-A" });
  check("decided row not overridden", overAff === 0 && (await decisionOf(a)) === "accepted", `affected=${overAff}`);

  // cleanup
  for (const id of [a, b, c, d]) await db.delete(universalAiUsageLogs).where(eq(universalAiUsageLogs.id, id));

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("verify-quality failed:", e); process.exit(1); });

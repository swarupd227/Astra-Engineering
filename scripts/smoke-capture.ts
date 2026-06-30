// Smoke: make ONE real Bedrock call (writes universal_ai_usage_logs) and insert
// one sample row into each of the other 3 tables — WITHOUT cleanup — so you can
// SELECT and see data. Rows are tagged 'SMOKE' so you can delete them later.
//
// Run:    npx tsx scripts/smoke-capture.ts
// Clean:  npx tsx scripts/smoke-capture.ts --clean
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "node:crypto";

const SMOKE_USER = "SMOKE-user";
const SMOKE_INST = "https://smoke.atlassian.net";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const clean = process.argv.includes("--clean");
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();

  if (clean) {
    await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id = ? OR feature_name='smoke'`, [SMOKE_USER]);
    await pool.query(`DELETE FROM jira_team_members WHERE jira_account_id = 'SMOKE-acct'`);
    await pool.query(`DELETE FROM jira_user_overrides WHERE jira_account_id = 'SMOKE-acct'`);
    await pool.query(`DELETE FROM productivity_targets WHERE period_start='2026-06-01' AND period_end='2026-06-30'`);
    console.log("Smoke rows deleted.");
    await pool.end();
    return;
  }

  // 1) Real Bedrock call → universal_ai_usage_logs
  const { withAiContext } = await import("../server/observability/ai-context");
  const { LLM }: any = await import("../server/llm-config");
  try {
    await withAiContext({ userId: SMOKE_USER, feature: "smoke", useCase: "smoke test" }, () =>
      LLM.createCompletion({ messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 16 }),
    );
    await sleep(2000);
  } catch (e: any) {
    console.warn("Bedrock call failed (a 'failed' row may still be written):", e?.message || e);
  }

  // 2) sample jira_team_members + 3) jira_user_overrides
  await pool.query(
    `INSERT INTO jira_team_members (id, user_id, jira_account_id, jira_display_name, jira_email, instance_url, project_key, project_name, active, match_method, match_confidence, synced_at)
     VALUES (?,?,?,?,?,?,?,?,1,'credential',1,NOW())
     ON DUPLICATE KEY UPDATE synced_at=NOW()`,
    [randomUUID(), SMOKE_USER, "SMOKE-acct", "Smoke User", "smoke@test.invalid", SMOKE_INST, "SMOKE", "Smoke Project"],
  );
  await pool.query(
    `INSERT INTO jira_user_overrides (id, instance_url, jira_account_id, user_id, created_by, created_at)
     VALUES (?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), created_at=NOW()`,
    [randomUUID(), SMOKE_INST, "SMOKE-acct", SMOKE_USER, SMOKE_USER],
  );
  // 4) sample productivity_targets
  await pool.query(
    `INSERT INTO productivity_targets (id, period_type, period_start, period_end, target_saved_hours, created_at)
     VALUES (?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE target_saved_hours=VALUES(target_saved_hours)`,
    [randomUUID(), "monthly", "2026-06-01", "2026-06-30", 100],
  );

  // Show counts + latest universal row
  for (const t of ["universal_ai_usage_logs", "jira_team_members", "jira_user_overrides", "productivity_targets"]) {
    const [r]: any = await pool.query(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`${t}: ${r[0].c} row(s)`);
  }
  const [latest]: any = await pool.query(
    `SELECT feature_name, use_case, provider, model_name, request_status, quality_decision,
            input_tokens, output_tokens, total_tokens, cost_usd, user_id
     FROM universal_ai_usage_logs WHERE feature_name='smoke' ORDER BY created_at DESC LIMIT 1`,
  );
  console.log("\nLatest universal_ai_usage_logs (smoke):", JSON.stringify(latest[0], null, 2));

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

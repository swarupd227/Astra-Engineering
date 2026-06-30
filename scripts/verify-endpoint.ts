// Step 8 verification: buildAiMetricsResponse contract + math + use-cases + scoping,
// against a deterministic seeded period (far-future to avoid real data).
//
// Run:  npx tsx scripts/verify-endpoint.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "node:crypto";

const INST = "https://verify8.atlassian.net";
const A = "u8-a", B = "u8-b";

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();
  const { buildAiMetricsResponse } = await import("../server/services/ai-metrics-service");

  // pre-clean any leftovers from a previous partial run
  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id IN (?,?)`, [A, B]);
  await pool.query(`DELETE FROM jira_team_members WHERE jira_account_id IN ('acct-u8-a','acct-u8-b')`);

  const PROJ = "proj-team8"; // sdlc project id used for project-wise attribution
  // ---- seed usage rows (period 2037-03), tagged to PROJ ----
  async function ins(r: any) {
    await pool.query(
      `INSERT INTO universal_ai_usage_logs
        (id, user_id, project_id, provider, model_name, feature_name, use_case, request_status, quality_decision,
         input_tokens, output_tokens, cache_tokens, total_tokens, cost_usd, currency, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'USD', ?)`,
      [randomUUID(), r.user, PROJ, r.provider, "test", r.feature, r.useCase, r.status, r.quality,
       r.in, r.out, r.cache, r.in + r.out + r.cache, r.cost, r.created],
    );
  }
  await ins({ user: A, provider: "claude", feature: "bot", useCase: "AI Bot Queries", status: "success", quality: "accepted", in: 100, out: 50, cache: 0, cost: "0.001000", created: "2037-03-10 10:00:00" });
  await ins({ user: A, provider: "claude", feature: "artifact", useCase: "artifact generation", status: "success", quality: "modified", in: 200, out: 100, cache: 10, cost: "0.002000", created: "2037-03-15 10:00:00" });
  await ins({ user: B, provider: "claude", feature: "brd", useCase: "brd generation", status: "failed", quality: "rejected", in: 0, out: 0, cache: 0, cost: "0.000000", created: "2037-03-20 10:00:00" });
  await ins({ user: B, provider: "bedrock", feature: "embedding", useCase: "embedding", status: "success", quality: "unrated", in: 20, out: 0, cache: 0, cost: "0.000100", created: "2037-03-22 10:00:00" });

  // ---- seed team members ----
  for (const u of [A, B]) {
    await pool.query(
      `INSERT INTO jira_team_members (id, user_id, jira_account_id, instance_url, project_id, project_key, project_name, active, match_method, synced_at)
       VALUES (?,?,?,?,?,?,?,1,'credential',NOW())`,
      [randomUUID(), u, `acct-${u}`, INST, PROJ, "TEAM8", "Team Eight"],
    );
  }

  let pass = 0, total = 0;
  const check = (n: string, c: boolean, e = "") => { total++; if (c) pass++; console.log(`${c ? "✓" : "✗"} ${n}${e ? ` — ${e}` : ""}`); };
  const approx = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  // ---- global (no jira) ----
  const g = await buildAiMetricsResponse({ startDate: "2037-03-01", endDate: "2037-03-31", periodType: "monthly" });

  check("total_requests = 4", g.usage.total_requests === 4, String(g.usage.total_requests));
  check("chatgpt_requests = 0", g.usage.chatgpt_requests === 0);
  check("custom_tool_requests = 0", g.usage.custom_tool_requests === 0);
  check("claude_requests = total", g.usage.claude_requests === g.usage.total_requests);
  // current/previous week are real-time "this week" snapshots (relative to today),
  // independent of the query period — so just assert they're valid numbers.
  check("current_week / previous_week are numbers (real-time)",
    typeof g.usage.current_week_requests === "number" && typeof g.usage.previous_week_requests === "number" &&
    g.usage.current_week_requests >= 0 && g.usage.previous_week_requests >= 0,
    `cw=${g.usage.current_week_requests} pw=${g.usage.previous_week_requests}`);

  check("tokens total = in+out+cache", g.tokens.total_tokens === g.tokens.input_tokens + g.tokens.output_tokens + g.tokens.cache_tokens,
    `${g.tokens.total_tokens} vs ${g.tokens.input_tokens}+${g.tokens.output_tokens}+${g.tokens.cache_tokens}`);
  check("tokens values (320/150/10/480)", g.tokens.input_tokens === 320 && g.tokens.output_tokens === 150 && g.tokens.cache_tokens === 10 && g.tokens.total_tokens === 480);

  const providerCostSum = g.providers.reduce((s, p) => s + p.cost_usd, 0);
  check("cost = sum(providers.cost_usd)", approx(g.cost.total_cost_usd, providerCostSum), `${g.cost.total_cost_usd} vs ${providerCostSum}`);
  check("cost total = 0.0031", approx(g.cost.total_cost_usd, 0.0031), String(g.cost.total_cost_usd));

  check("reliability success+failed=total", g.reliability.successful_requests + g.reliability.failed_requests === g.reliability.total_requests,
    `${g.reliability.successful_requests}+${g.reliability.failed_requests}=${g.reliability.total_requests}`);
  check("reliability success=3 failed=1", g.reliability.successful_requests === 3 && g.reliability.failed_requests === 1);

  check("quality parts sum to total_outputs",
    g.quality.accepted_outputs + g.quality.modified_outputs + g.quality.rejected_outputs + g.quality.unrated_outputs === g.quality.total_outputs);
  check("quality counts (1/1/1/1, total 4)",
    g.quality.accepted_outputs === 1 && g.quality.modified_outputs === 1 && g.quality.rejected_outputs === 1 && g.quality.unrated_outputs === 1 && g.quality.total_outputs === 4);

  check("use_cases bot=1 artifact=1 doc=1 bug=0 code=0",
    g.use_cases.bot_query_count === 1 && g.use_cases.artifact_generation_count === 1 &&
    g.use_cases.documentation_generation_count === 1 && g.use_cases.bug_detection_count === 0 && g.use_cases.code_accepted_count === 0,
    JSON.stringify(g.use_cases));

  check("providers has claude+bedrock", g.providers.length === 2 && g.providers.some(p => p.provider === "claude") && g.providers.some(p => p.provider === "bedrock"));
  const claude = g.providers.find(p => p.provider === "claude")!;
  check("claude provider requests=3", claude.requests === 3 && claude.successful_requests === 2 && claude.failed_requests === 1);

  check("adoption active_users=2", g.adoption.active_users === 2, String(g.adoption.active_users));
  check("comparison previous_total_requests=0", g.comparison.previous_total_requests === 0);
  check("comparison prev dates (2037-02-01..2037-02-28)", g.comparison.previous_period_start_date === "2037-02-01" && g.comparison.previous_period_end_date === "2037-02-28",
    `${g.comparison.previous_period_start_date}..${g.comparison.previous_period_end_date}`);

  check("global teams empty, users populated (team_id=null)",
    g.teams.length === 0 && g.users.length === 2 && g.users.every((u) => u.team_id === null),
    `teams=${g.teams.length} users=${g.users.length}`);

  // ---- scoped by KEY ----
  const sk = await buildAiMetricsResponse({ startDate: "2037-03-01", endDate: "2037-03-31", periodType: "monthly", jiraInstance: INST, jiraProject: "TEAM8" });
  check("scoped(key) one team", sk.teams.length === 1, String(sk.teams.length));
  if (sk.teams[0]) {
    const t = sk.teams[0];
    check("team totals", t.team_id === "TEAM8" && t.total_members === 2 && t.active_users === 2 && t.total_requests === 4 &&
      t.accepted_outputs === 1 && t.modified_outputs === 1 && t.rejected_outputs === 1, JSON.stringify(t));
  }
  check("scoped users = 2", sk.users.length === 2, String(sk.users.length));

  // ---- scoped by NAME ----
  const sn = await buildAiMetricsResponse({ startDate: "2037-03-01", endDate: "2037-03-31", periodType: "monthly", jiraInstance: INST, jiraProject: "Team Eight" });
  check("scoped(name) resolves same team", sn.teams.length === 1 && sn.teams[0]?.team_id === "TEAM8");

  // cleanup
  await pool.query(`DELETE FROM universal_ai_usage_logs WHERE user_id IN (?,?)`, [A, B]);
  await pool.query(`DELETE FROM jira_team_members WHERE jira_account_id IN ('acct-u8-a','acct-u8-b')`);

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("verify-endpoint failed:", e); process.exit(1); });

// Step 6 verification: project resolution by key OR name, the tiered user
// resolver (manual > credential > email > unmatched), and sticky overrides.
//
// Run:  npx tsx scripts/verify-jira-mapping.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "node:crypto";

const INST = "https://verify-test.atlassian.net";
const cleanInst = INST.replace(/\/+$/, "").toLowerCase();

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();
  const svc = await import("../server/integrations/jira/team-sync-service");

  let pass = 0, total = 0;
  const check = (n: string, c: boolean, e = "") => { total++; if (c) pass++; console.log(`${c ? "✓" : "✗"} ${n}${e ? ` — ${e}` : ""}`); };

  // Pick an existing non-deleted user for mapping targets.
  const [usersRows]: any = await pool.query(
    `SELECT id, email, display_name FROM users WHERE is_deleted = 0 AND email IS NOT NULL LIMIT 1`,
  );
  const U = usersRows[0];
  if (!U) { console.log("No users found — cannot run resolver tiers"); process.exit(1); }

  // ---- resolveProjects by key AND name (real jira_settings) ----
  const [js]: any = await pool.query(
    `SELECT s.instance_url, s.project_key, p.name AS project_name
       FROM jira_settings s LEFT JOIN sdlc_projects p ON s.project_id = p.id
      WHERE s.is_active = 1 AND s.api_token_encrypted IS NOT NULL AND p.name IS NOT NULL LIMIT 1`,
  );
  if (js[0]) {
    const byKey = await svc.resolveProjects(js[0].instance_url, js[0].project_key);
    const byName = await svc.resolveProjects(js[0].instance_url, js[0].project_name);
    check("resolveProjects by KEY finds project", byKey.some((p) => p.projectKey === js[0].project_key));
    check("resolveProjects by NAME finds same project", byName.some((p) => p.projectKey === js[0].project_key));
  } else {
    console.log("• (no decryptable jira_settings row with a project name — skipping resolveProjects live check)");
  }

  // ---- Tiered resolver (seed temp rows) ----
  const acct = "t-acct-verify";
  // email tier (only valid if this email is unique)
  const [emailCount]: any = await pool.query(
    `SELECT COUNT(*) AS c FROM users WHERE LOWER(TRIM(email)) = ? AND is_deleted = 0`, [String(U.email).trim().toLowerCase()]);
  if (emailCount[0].c === 1) {
    const r = await svc.resolveUser(cleanInst, { accountId: "t-acct-none", emailAddress: U.email });
    check("email tier maps to users.id", r.method === "email" && r.userId === U.id, r.method);
  } else {
    console.log(`• (email '${U.email}' not unique — skipping email tier)`);
  }

  // credential tier
  await pool.query(
    `INSERT INTO user_jira_credentials (id, user_id, instance_url, email, api_token_encrypted, account_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [randomUUID(), U.id, INST, "verify@test.invalid", "x", acct],
  );
  let r = await svc.resolveUser(cleanInst, { accountId: acct, emailAddress: "no-match@nowhere.invalid" });
  check("credential tier maps to users.id", r.method === "credential" && r.userId === U.id, r.method);

  // manual override wins over credential
  await svc.setJiraUserOverride({ instanceUrl: INST, jiraAccountId: acct, userId: U.id });
  r = await svc.resolveUser(cleanInst, { accountId: acct });
  check("manual override wins (method=manual)", r.method === "manual" && r.userId === U.id, r.method);

  // unmatched
  r = await svc.resolveUser(cleanInst, { accountId: "t-acct-zzz", emailAddress: "nobody@nowhere.invalid", displayName: "Zzz No Match 99999" });
  check("unmatched when nothing matches", r.method === "unmatched" && r.userId === null, r.method);

  // ---- override re-applies to existing membership rows ----
  await pool.query(
    `INSERT INTO jira_team_members (id, user_id, jira_account_id, instance_url, project_key, active, match_method, synced_at)
     VALUES (?, NULL, ?, ?, 'TST', 1, 'unmatched', NOW())`,
    [randomUUID(), acct, INST],
  );
  await svc.setJiraUserOverride({ instanceUrl: INST, jiraAccountId: acct, userId: U.id });
  const [mem]: any = await pool.query(
    `SELECT user_id, match_method FROM jira_team_members WHERE jira_account_id = ? AND project_key='TST' LIMIT 1`, [acct]);
  check("override re-applies to existing member", mem[0]?.user_id === U.id && mem[0]?.match_method === "manual",
    JSON.stringify(mem[0]));

  // cleanup
  await pool.query(`DELETE FROM user_jira_credentials WHERE account_id = ?`, [acct]);
  await pool.query(`DELETE FROM jira_user_overrides WHERE jira_account_id = ?`, [acct]);
  await pool.query(`DELETE FROM jira_team_members WHERE jira_account_id = ?`, [acct]);

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("verify-jira-mapping failed:", e); process.exit(1); });

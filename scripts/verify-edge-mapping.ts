// Edge case: a member added to a project BEFORE the user has a DevX account is
// stored 'unmatched'; when that user logs in (Cognito), claimJiraMembershipsForUser
// maps them instantly — by email and by connected-PAT credential. Plus syncAllProjects.
//
// Run:  npx tsx scripts/verify-edge-mapping.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "node:crypto";

const INST = "https://edge.atlassian.net";

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();
  const svc = await import("../server/integrations/jira/team-sync-service");

  const [uRows]: any = await pool.query(`SELECT id FROM users WHERE is_deleted=0 LIMIT 1`);
  const U = uRows[0].id;

  let pass = 0, total = 0;
  const check = (n: string, c: boolean, e = "") => { total++; if (c) pass++; console.log(`${c ? "✓" : "✗"} ${n}${e ? ` — ${e}` : ""}`); };

  // pre-clean
  await pool.query(`DELETE FROM jira_team_members WHERE jira_account_id IN ('edge-email-acct','edge-cred-acct')`);
  await pool.query(`DELETE FROM user_jira_credentials WHERE account_id = 'edge-cred-acct'`);

  // ---- Scenario 1: new project member, no DevX account yet → stored unmatched ----
  await pool.query(
    `INSERT INTO jira_team_members (id, user_id, jira_account_id, jira_email, instance_url, project_key, active, match_method, synced_at)
     VALUES (?, NULL, 'edge-email-acct', 'edgeuser@test.invalid', ?, 'EDGE', 1, 'unmatched', NOW())`,
    [randomUUID(), INST],
  );
  let [m]: any = await pool.query(`SELECT user_id, match_method FROM jira_team_members WHERE jira_account_id='edge-email-acct'`);
  check("starts unmatched", m[0].user_id === null && m[0].match_method === "unmatched");

  // user logs in (Cognito) → claim by email
  const claimedEmail = await svc.claimJiraMembershipsForUser({ userId: U, email: "edgeuser@test.invalid" });
  [m] = await pool.query(`SELECT user_id, match_method FROM jira_team_members WHERE jira_account_id='edge-email-acct'`);
  check("claimed by EMAIL on login", claimedEmail >= 1 && m[0].user_id === U && m[0].match_method === "email",
    `claimed=${claimedEmail} method=${m[0].match_method}`);

  // ---- Scenario 2: member matched via connected JIRA PAT (credential) ----
  await pool.query(
    `INSERT INTO jira_team_members (id, user_id, jira_account_id, instance_url, project_key, active, match_method, synced_at)
     VALUES (?, NULL, 'edge-cred-acct', ?, 'EDGE', 1, 'unmatched', NOW())`,
    [randomUUID(), INST],
  );
  await pool.query(
    `INSERT INTO user_jira_credentials (id, user_id, instance_url, email, api_token_encrypted, account_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'cred@test.invalid', 'x', 'edge-cred-acct', 1, NOW(), NOW())`,
    [randomUUID(), U, INST],
  );
  const claimedCred = await svc.claimJiraMembershipsForUser({ userId: U });
  [m] = await pool.query(`SELECT user_id, match_method FROM jira_team_members WHERE jira_account_id='edge-cred-acct'`);
  check("claimed by CREDENTIAL on login", claimedCred >= 1 && m[0].user_id === U && m[0].match_method === "credential",
    `claimed=${claimedCred} method=${m[0].match_method}`);

  // ---- Scenario 3: org onboarding sync-all (scoped to a known real instance) ----
  const all = await svc.syncAllProjects("https://jiratest26.atlassian.net");
  check("syncAllProjects ran for >=1 project", all.projects >= 1, `projects=${all.projects}`);

  // cleanup
  await pool.query(`DELETE FROM jira_team_members WHERE jira_account_id IN ('edge-email-acct','edge-cred-acct')`);
  await pool.query(`DELETE FROM user_jira_credentials WHERE account_id = 'edge-cred-acct'`);

  await pool.end();
  console.log(`\n${pass}/${total} checks passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("verify-edge-mapping failed:", e); process.exit(1); });

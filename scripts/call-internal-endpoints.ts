// Invoke the 3 internal admin operations via their service layer (same code the
// POST /api/internal/* endpoints run), populating the 3 tables with real data.
//
// Run:  npx tsx scripts/call-internal-endpoints.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase();
  const pool = getPool();
  const { syncJiraTeam, setJiraUserOverride } = await import("../server/integrations/jira/team-sync-service");
  const { upsertProductivityTarget } = await import("../server/observability/productivity");

  // ---- discover a real jira_settings row to sync against ----
  const [candidates]: any = await pool.query(
    `SELECT s.instance_url, s.project_key, p.name AS project_name
       FROM jira_settings s LEFT JOIN sdlc_projects p ON s.project_id = p.id
      WHERE s.is_active = 1 AND s.api_token_encrypted IS NOT NULL
      LIMIT 5`,
  );
  console.log(`\n[jira_settings candidates]`, candidates);

  // ============ 1) /api/internal/jira-team-sync ============
  if (candidates[0]) {
    const c = candidates[0];
    console.log(`\n=== jira-team-sync(instance='${c.instance_url}', project='${c.project_key}') ===`);
    const result = await syncJiraTeam({ instanceUrl: c.instance_url, project: c.project_key });
    console.log("sync result:", JSON.stringify(result, null, 2));

    const [members]: any = await pool.query(
      `SELECT jira_account_id, jira_display_name, jira_email, user_id, match_method, project_key
         FROM jira_team_members
        WHERE LOWER(TRIM(TRAILING '/' FROM instance_url)) = LOWER(TRIM(TRAILING '/' FROM ?))
        ORDER BY synced_at DESC LIMIT 10`,
      [c.instance_url],
    );
    console.log(`jira_team_members (top 10):`, members);

    // ============ 2) /api/internal/jira-user-map ============
    // Map the first member's JIRA accountId to an existing users.id (sticky override).
    const [u]: any = await pool.query(`SELECT id FROM users WHERE is_deleted = 0 LIMIT 1`);
    if (members[0] && u[0]) {
      console.log(`\n=== jira-user-map(accountId='${members[0].jira_account_id}' -> user '${u[0].id}') ===`);
      await setJiraUserOverride({ instanceUrl: c.instance_url, jiraAccountId: members[0].jira_account_id, userId: u[0].id });
      const [ovr]: any = await pool.query(
        `SELECT instance_url, jira_account_id, user_id FROM jira_user_overrides WHERE jira_account_id = ?`,
        [members[0].jira_account_id],
      );
      console.log("jira_user_overrides:", ovr);
    } else {
      console.log("\n(jira-user-map skipped — no synced members or no users)");
    }
  } else {
    console.log("\n(no jira_settings rows — jira-team-sync skipped; check the project has JIRA configured)");
  }

  // ============ 3) /api/internal/productivity-target ============
  console.log(`\n=== productivity-target(monthly 2026-06-01..2026-06-30 = 120h) ===`);
  await upsertProductivityTarget({ periodType: "monthly", periodStart: "2026-06-01", periodEnd: "2026-06-30", targetSavedHours: 120 });
  const [pt]: any = await pool.query(
    `SELECT period_type, period_start, period_end, target_saved_hours FROM productivity_targets ORDER BY created_at DESC LIMIT 5`,
  );
  console.log("productivity_targets:", pt);

  // ---- final counts ----
  console.log("\n[final counts]");
  for (const t of ["jira_team_members", "jira_user_overrides", "productivity_targets"]) {
    const [r]: any = await pool.query(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`  ${t}: ${r[0].c}`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

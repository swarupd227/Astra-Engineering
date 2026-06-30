import "dotenv/config"; import dotenv from "dotenv"; dotenv.config();
import mysql from "mysql2/promise";

// READ-ONLY diagnostic against LIVE qadevxdb_test3.
const EMAIL = process.argv[2] || "omjha@nousinfo.com";

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets();
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: "qadevxdb_test3", // FORCE live db
  });
  const q = async (sql: string, p: any[] = []) => (await conn.query(sql, p))[0] as any[];

  console.log("DB =", (await q("SELECT DATABASE() db"))[0].db, "\n");

  const usr = await q(
    "SELECT id, email, display_name, provider, onboarding_completed, tenant_id FROM users WHERE LOWER(email)=LOWER(?)",
    [EMAIL],
  );
  console.log("=== users row ===");
  console.table(usr);
  if (!usr.length) { console.log("No users row for", EMAIL); await conn.end(); return; }
  const uid = usr[0].id;

  console.log("=== user_jira_credentials ===");
  console.table(await q(
    "SELECT id, instance_url, email, account_id, display_name, is_active, last_tested_at FROM user_jira_credentials WHERE user_id=?",
    [uid],
  ));

  console.log("=== jira_team_members rows linked to THIS user (by user_id) ===");
  console.table(await q(
    "SELECT instance_url, project_key, jira_account_id, jira_email, match_method, active FROM jira_team_members WHERE user_id=?",
    [uid],
  ));

  console.log("=== jira_team_members rows that match THIS user's jira account_id (regardless of link) ===");
  console.table(await q(
    `SELECT jtm.instance_url, jtm.project_key, jtm.jira_account_id, jtm.user_id, jtm.match_method
       FROM jira_team_members jtm
       JOIN user_jira_credentials ujc ON ujc.account_id COLLATE utf8mb4_unicode_ci = jtm.jira_account_id
      WHERE ujc.user_id=?`,
    [uid],
  ));

  console.log("=== jira_team_members totals per instance/project ===");
  console.table(await q(
    `SELECT instance_url, project_key, COUNT(*) total,
            SUM(user_id IS NULL) unmatched, SUM(user_id IS NOT NULL) matched, MAX(synced_at) last_sync
       FROM jira_team_members GROUP BY instance_url, project_key ORDER BY last_sync DESC LIMIT 20`,
  ));

  await conn.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

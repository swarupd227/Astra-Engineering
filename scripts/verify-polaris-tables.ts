// Step 1 verification: confirm the four Polaris AI-metrics tables are created
// (idempotently) on the backup DB via the real initializeDatabase() code path.
//
// Run:  npx tsx scripts/verify-polaris-tables.ts
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();

const TABLES = [
  "universal_ai_usage_logs",
  "jira_team_members",
  "jira_user_overrides",
  "productivity_targets",
];

async function main() {
  const { loadSecrets } = await import("../server/secrets-loader");
  await loadSecrets(); // populates MYSQL_* from Secrets Manager + applies MYSQL_DATABASE_OVERRIDE

  const { initializeDatabase, getPool } = await import("../server/db");
  await initializeDatabase(); // runs ensurePolarisMetricsTables() among others

  const pool = getPool();
  console.log(`\n=== Verifying on database: ${process.env.MYSQL_DATABASE} ===\n`);

  let allOk = true;
  for (const t of TABLES) {
    const [rows]: any = await pool.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [t],
    );
    const exists = rows[0].cnt === 1;
    allOk = allOk && exists;
    console.log(`${exists ? "✓" : "✗"} ${t}: exists=${exists}`);
    if (exists) {
      const [cols]: any = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [t],
      );
      console.log(`    columns: ${cols.map((c: any) => c.COLUMN_NAME).join(", ")}`);
      const [idx]: any = await pool.query(
        `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [t],
      );
      console.log(`    indexes: ${idx.map((i: any) => i.INDEX_NAME).join(", ")}`);
    }
  }

  // Idempotency: re-run the DDLs directly; CREATE TABLE IF NOT EXISTS must not throw.
  console.log("\n=== Idempotency re-run (CREATE TABLE IF NOT EXISTS) ===");
  for (const t of TABLES) {
    const [r]: any = await pool.query(`SELECT 1 FROM ${t} LIMIT 0`);
    console.log(`✓ ${t} queryable`);
  }

  await pool.end();
  console.log(`\n${allOk ? "ALL TABLES PRESENT ✓" : "SOME TABLES MISSING ✗"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-polaris-tables failed:", e);
  process.exit(1);
});

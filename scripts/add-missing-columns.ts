/**
 * One-time migration: adds columns that exist in the Drizzle schema
 * but are missing from the actual RDS database after the develop merge.
 *
 * Usage:  npx tsx scripts/add-missing-columns.ts
 */
import "../server/dom-polyfills";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const hosting = process.env.DEVX_HOSTING?.toLowerCase();
  if (hosting === "aws") {
    const { loadSecrets } = await import("../server/secrets-loader");
    await loadSecrets();
  }

  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 2,
  });

  const columns: { table: string; column: string; definition: string }[] = [
    { table: "sdlc_projects", column: "specs_architecture_style", definition: "VARCHAR(50) DEFAULT NULL" },
    { table: "sdlc_projects", column: "specs_delivery_order", definition: "TEXT DEFAULT NULL" },
    { table: "integrations", column: "organization_id", definition: "VARCHAR(36) DEFAULT NULL" },
  ];

  for (const { table, column, definition } of columns) {
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.MYSQL_DATABASE, table, column],
      );
      if ((rows as any)[0].cnt > 0) {
        console.log(`SKIP (exists): ${table}.${column}`);
        continue;
      }
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`OK: Added ${table}.${column}`);
    } catch (err: any) {
      console.error(`FAIL: ${table}.${column}:`, err.message);
    }
  }

  await pool.end();
  console.log("Done.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

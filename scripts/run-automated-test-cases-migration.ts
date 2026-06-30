/**
 * Run the automated-test cases/scripts/runs/results tables migration.
 * Usage: npx tsx scripts/run-automated-test-cases-migration.ts
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { poolConnection } from "../server/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  "..",
  "migrations",
  "manual",
  "add-automated-test-cases-scripts-runs.sql"
);

async function run() {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("CREATE TABLE"));
  console.log("[automated-test migration] Running", statements.length, "statements...");
  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await poolConnection.query(stmt + ";");
      console.log("[automated-test migration] OK:", stmt.slice(0, 60) + "...");
    } catch (e: any) {
      console.error("[automated-test migration] Failed:", e?.message);
      throw e;
    }
  }
  console.log("[automated-test migration] Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

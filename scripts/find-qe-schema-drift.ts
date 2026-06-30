/**
 * scripts/find-qe-schema-drift.ts
 *
 * One-off introspection tool: connects to the AWS Aurora QE database, dumps
 * the live column lists for every QE table, compares them against
 * `shared/qe-schema.ts` (using Drizzle's `getTableConfig` to get the schema
 * truth), and prints a ready-to-paste `migrations` block for the runtime
 * migrator in `server/qe/db.ts`.
 *
 * Why we need this:
 *   The AWS Aurora QE DB was originally seeded by an older copy of
 *   `qe-schema.ts` (via `sync-schema.cjs`), so most QE tables are missing
 *   newer columns added in the NAT branch. Adding them one column at a time
 *   in response to "Unknown column" errors is whack-a-mole. This script
 *   finds every missing column in one pass.
 *
 * Run:   npx tsx scripts/find-qe-schema-drift.ts
 *
 * Dependencies on env: same as the rest of the app — DEVX_HOSTING=aws +
 * AWS bootstrap creds in `.env` so we can pull MYSQL_* from Secrets Manager.
 *
 * After running:
 *   1. Copy the printed `migrations` block.
 *   2. Replace the `migrations` constant in `server/qe/db.ts:runSchemaMigration`.
 *   3. Restart the dev server. All ALTER TABLE statements run idempotently;
 *      missing columns get added, existing ones are skipped.
 *   4. Delete this script (it's a one-off, not a recurring tool).
 */

import "dotenv/config";

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { getTableConfig } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { Table } from "drizzle-orm";
import mysql from "mysql2/promise";

import * as schema from "../shared/qe-schema";

const SECRET_NAME = process.env.AWS_SECRET_NAME || "devx/platform/qa";
const REGION = process.env.AWS_REGION || "ap-south-1";
const REQUIRED_KEYS = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];

async function loadMysqlFromSecretsManager(): Promise<void> {
  console.log(
    `[drift] Fetching MYSQL_* from Secrets Manager: secret="${SECRET_NAME}", region="${REGION}"`,
  );
  const client = new SecretsManagerClient({ region: REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  if (!response.SecretString) {
    throw new Error(`Secret "${SECRET_NAME}" has no SecretString.`);
  }
  const parsed = JSON.parse(response.SecretString);
  for (const key of REQUIRED_KEYS) {
    if (parsed[key] !== undefined && parsed[key] !== null) {
      process.env[key] = String(parsed[key]);
    }
  }
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing MYSQL_* keys after Secrets Manager fetch: ${missing.join(", ")}`);
  }
  console.log(
    `[drift] Target: ${process.env.MYSQL_USER}@${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE}`,
  );
}

/**
 * Render a Drizzle column object as the MySQL DDL fragment that would be
 * used in `ADD COLUMN <fragment>`. Intentionally lenient: drops NOT NULL
 * because pre-existing rows may not satisfy it. Drops FK constraints for
 * the same reason. Defaults are preserved when statically expressible.
 */
function columnToDDL(col: any): string | null {
  const name = col.name as string;
  const type: string = col.columnType ?? col.dataType ?? "";
  const sizeOpt = (col as any).length ?? (col as any).size;

  let ddl: string;
  switch (type) {
    case "MySqlVarChar":
      ddl = `${name} VARCHAR(${sizeOpt ?? 255})`;
      break;
    case "MySqlText":
    case "MySqlLongText":
    case "MySqlMediumText":
    case "MySqlTinyText":
      ddl = `${name} TEXT`;
      break;
    case "MySqlInt":
    case "MySqlSerial":
      ddl = `${name} INT`;
      break;
    case "MySqlBigInt53":
    case "MySqlBigInt64":
      ddl = `${name} BIGINT`;
      break;
    case "MySqlBoolean":
      ddl = `${name} BOOLEAN`;
      break;
    case "MySqlTimestamp":
    case "MySqlTimestampString":
      ddl = `${name} TIMESTAMP NULL`;
      break;
    case "MySqlDateTime":
    case "MySqlDateTimeString":
      ddl = `${name} DATETIME NULL`;
      break;
    case "MySqlDate":
    case "MySqlDateString":
      ddl = `${name} DATE NULL`;
      break;
    case "MySqlJson":
      ddl = `${name} JSON`;
      break;
    case "MySqlChar":
      ddl = `${name} CHAR(${sizeOpt ?? 1})`;
      break;
    case "MySqlDecimal":
      ddl = `${name} DECIMAL`;
      break;
    case "MySqlDouble":
      ddl = `${name} DOUBLE`;
      break;
    case "MySqlReal":
    case "MySqlFloat":
      ddl = `${name} FLOAT`;
      break;
    default:
      console.warn(
        `[drift] Unknown column type for ${name}: columnType="${col.columnType}" dataType="${col.dataType}" — skipping.`,
      );
      return null;
  }

  const def = (col as any).default;
  if (def !== undefined && def !== null && typeof def !== "object") {
    if (typeof def === "string") {
      ddl += ` DEFAULT '${def.replace(/'/g, "''")}'`;
    } else if (typeof def === "number" || typeof def === "boolean") {
      ddl += ` DEFAULT ${def}`;
    }
  }

  return ddl;
}

async function main(): Promise<void> {
  await loadMysqlFromSecretsManager();

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST!,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
    ssl: { rejectUnauthorized: false },
  });

  const [allColsRows] = await conn.execute<any[]>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?`,
    [process.env.MYSQL_DATABASE],
  );
  const dbColumnsByTable = new Map<string, Set<string>>();
  for (const row of allColsRows as Array<{ TABLE_NAME: string; COLUMN_NAME: string }>) {
    if (!dbColumnsByTable.has(row.TABLE_NAME)) {
      dbColumnsByTable.set(row.TABLE_NAME, new Set());
    }
    dbColumnsByTable.get(row.TABLE_NAME)!.add(row.COLUMN_NAME);
  }
  console.log(`[drift] AWS DB has ${dbColumnsByTable.size} tables.\n`);

  const driftByTable: Record<string, string[]> = {};
  const tablesMissingFromDB: string[] = [];

  for (const [exportName, exportValue] of Object.entries(schema)) {
    if (!exportValue || typeof exportValue !== "object") continue;
    if (!(exportValue as any)[Symbol.for("drizzle:IsDrizzleTable")]) continue;
    if (!(exportValue instanceof Table) && !((exportValue as any)[Symbol.for("drizzle:Name")])) continue;

    let cfg;
    try {
      cfg = getTableConfig(exportValue as MySqlTable);
    } catch {
      continue;
    }

    const tableName = cfg.name;
    const dbCols = dbColumnsByTable.get(tableName);

    if (!dbCols) {
      tablesMissingFromDB.push(tableName);
      continue;
    }

    const missingCols: string[] = [];
    for (const col of cfg.columns) {
      if (!dbCols.has(col.name)) {
        const ddl = columnToDDL(col);
        if (ddl) missingCols.push(ddl);
      }
    }

    if (missingCols.length > 0) {
      driftByTable[tableName] = missingCols;
    }
  }

  await conn.end();

  console.log("=".repeat(72));
  console.log("DRIFT REPORT — columns in qe-schema.ts but missing from AWS DB");
  console.log("=".repeat(72));

  const tablesWithDrift = Object.keys(driftByTable).sort();
  if (tablesWithDrift.length === 0) {
    console.log("No drift! Every QE table column from qe-schema.ts is present in the AWS DB.");
  } else {
    console.log(
      `\n${tablesWithDrift.length} table(s) need ALTER TABLE ADD COLUMN. Paste this into\n` +
        `runSchemaMigration() in server/qe/db.ts (replacing the existing migrations object):\n`,
    );
    console.log("      const migrations: Record<string, string[]> = {");
    for (const t of tablesWithDrift) {
      console.log(`        ${t}: [`);
      for (const c of driftByTable[t]) {
        console.log(`          ${JSON.stringify(c)},`);
      }
      console.log(`        ],`);
    }
    console.log("      };");
  }

  if (tablesMissingFromDB.length > 0) {
    console.log("\n" + "=".repeat(72));
    console.log(
      `WARNING: ${tablesMissingFromDB.length} table(s) defined in qe-schema.ts are\n` +
        `entirely missing from the AWS DB. ALTER TABLE ADD COLUMN can't help — these\n` +
        `need CREATE TABLE. Likely candidates for sync-schema.cjs to handle, or for\n` +
        `a one-off SQL run.\n`,
    );
    for (const t of tablesMissingFromDB.sort()) {
      console.log(`  - ${t}`);
    }
  }

  console.log("\n[drift] Done.");
}

main().catch((err) => {
  console.error("\n[drift] Failed:", err);
  process.exit(1);
});

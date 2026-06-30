/**
 * Ensures the target database (MYSQL_DATABASE from .env) has all required tables.
 *
 * Strategy:
 * 1. Connect to the same MySQL server using SOURCE db (qadevxdb) as reference
 * 2. Get all table DDL from the source
 * 3. Create missing tables in the target database using CREATE TABLE IF NOT EXISTS
 * 4. Seed critical lookup data (roles, subscription_types)
 *
 * Usage:  npx tsx scripts/ensure-db-schema.ts
 *
 * Safe to re-run — only creates tables that don't exist and uses INSERT IGNORE for seeds.
 */

import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

const TARGET_DB = process.env.MYSQL_DATABASE || "jiratest";
const SOURCE_DB = process.env.SOURCE_MYSQL_DATABASE || "qadevxdb";
const HOST = process.env.MYSQL_HOST!;
const PORT = parseInt(process.env.MYSQL_PORT || "3306", 10);
const USER = process.env.MYSQL_USER!;
const PASSWORD = process.env.MYSQL_PASSWORD!;

async function main() {
  if (!HOST || !USER || !PASSWORD) {
    console.error("Missing MYSQL_HOST, MYSQL_USER, or MYSQL_PASSWORD in .env");
    process.exit(1);
  }

  console.log(`\n=== Database Schema Sync ===`);
  console.log(`Source: ${SOURCE_DB}  →  Target: ${TARGET_DB}`);
  console.log(`Host:   ${HOST}:${PORT}\n`);

  const conn = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    ssl: { rejectUnauthorized: false },
    multipleStatements: true,
  });

  try {
    // Ensure target database exists
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${TARGET_DB}\``);
    console.log(`✓ Database '${TARGET_DB}' exists`);

    // Get all tables from source database
    const [srcTables] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [SOURCE_DB]
    );

    // Get existing tables in target
    const [tgtTables] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [TARGET_DB]
    );
    const existingTables = new Set(tgtTables.map((r: any) => r.TABLE_NAME));

    console.log(`Source has ${srcTables.length} tables, target has ${existingTables.size} tables\n`);

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Switch to source DB to get DDL
    await conn.query(`USE \`${SOURCE_DB}\``);

    for (const row of srcTables) {
      const tableName = (row as any).TABLE_NAME;

      if (existingTables.has(tableName)) {
        skipped++;
        continue;
      }

      try {
        // Get CREATE TABLE DDL from source
        const [ddlRows] = await conn.query<mysql.RowDataPacket[]>(
          `SHOW CREATE TABLE \`${SOURCE_DB}\`.\`${tableName}\``
        );
        let ddl = (ddlRows[0] as any)["Create Table"] as string;

        // Replace any hardcoded database references and add IF NOT EXISTS
        ddl = ddl.replace(/^CREATE TABLE/, "CREATE TABLE IF NOT EXISTS");

        // Switch to target and create
        await conn.query(`USE \`${TARGET_DB}\``);
        await conn.query(ddl);
        console.log(`  ✓ Created: ${tableName}`);
        created++;

        // Switch back to source for next iteration
        await conn.query(`USE \`${SOURCE_DB}\``);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("already exists")) {
          skipped++;
        } else {
          errors.push(`${tableName}: ${msg}`);
          console.error(`  ✗ Failed: ${tableName} — ${msg}`);
        }
        // Ensure we're back on source for next iteration
        try { await conn.query(`USE \`${SOURCE_DB}\``); } catch {}
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`Created: ${created}  |  Skipped (exist): ${skipped}  |  Errors: ${errors.length}`);

    // Now seed critical lookup data in target DB
    await conn.query(`USE \`${TARGET_DB}\``);
    console.log(`\n=== Seeding Critical Data ===`);

    // Seed roles
    try {
      await conn.query(`
        INSERT IGNORE INTO roles (id, name, description)
        VALUES
          (1, 'TenantAdmin', 'Full administrative access to tenant'),
          (2, 'OrgAdmin', 'Organization-level administrator'),
          (3, 'Viewer', 'Read-only access')
      `);
      console.log(`✓ Roles seeded (TenantAdmin, OrgAdmin, Viewer)`);
    } catch (err: any) {
      console.warn(`  roles seed: ${err?.message || err}`);
    }

    // Seed subscription_types
    try {
      await conn.query(`
        INSERT IGNORE INTO subscription_types (code, name, description, is_active)
        VALUES ('DEFAULT', 'Default Subscription', 'Initial subscription with all features enabled', 1)
      `);
      console.log(`✓ subscription_types seeded (DEFAULT)`);
    } catch (err: any) {
      console.warn(`  subscription_types seed: ${err?.message || err}`);
    }

    // Copy roles data from source if target is empty
    try {
      const [roleCount] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM \`${TARGET_DB}\`.roles`
      );
      if ((roleCount[0] as any).cnt === 0 || (roleCount[0] as any).cnt < 3) {
        const [srcRoles] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT * FROM \`${SOURCE_DB}\`.roles`
        );
        for (const role of srcRoles) {
          const r = role as any;
          await conn.query(
            `INSERT IGNORE INTO \`${TARGET_DB}\`.roles (id, name, description) VALUES (?, ?, ?)`,
            [r.id, r.name, r.description]
          );
        }
        console.log(`✓ Copied ${srcRoles.length} roles from source`);
      }
    } catch (err: any) {
      console.warn(`  roles copy: ${err?.message || err}`);
    }

    // Copy subscription_types from source if target is empty
    try {
      const [subCount] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM \`${TARGET_DB}\`.subscription_types`
      );
      if ((subCount[0] as any).cnt === 0) {
        const [srcSubs] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT * FROM \`${SOURCE_DB}\`.subscription_types`
        );
        for (const sub of srcSubs) {
          const s = sub as any;
          try {
            await conn.query(
              `INSERT IGNORE INTO \`${TARGET_DB}\`.subscription_types (id, code, name, description, is_active) VALUES (?, ?, ?, ?, ?)`,
              [s.id, s.code, s.name, s.description, s.is_active]
            );
          } catch {}
        }
        console.log(`✓ Copied ${srcSubs.length} subscription_types from source`);
      }
    } catch (err: any) {
      console.warn(`  subscription_types copy: ${err?.message || err}`);
    }

    if (errors.length > 0) {
      console.log(`\n⚠ Errors:`);
      errors.forEach((e) => console.log(`  - ${e}`));
    }

    console.log(`\n✅ Schema sync complete. Target database '${TARGET_DB}' is ready.\n`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

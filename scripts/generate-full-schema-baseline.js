#!/usr/bin/env node
/**
 * Generate migrations/baseline/00_full_schema.sql — complete prod parity baseline.
 *
 * Mode 1 (preferred): MYSQL_* set → SHOW CREATE TABLE for every table in DB
 * Mode 2 (fallback):   Merge CREATE TABLE from all migration SQL files + gap DDL
 *
 * Usage:
 *   node scripts/generate-full-schema-baseline.js
 *   node scripts/generate-full-schema-baseline.js --from-db-only
 *
 * After generation:
 *   npm run migrate:order:generate
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_FILE = join(REPO_ROOT, 'migrations', 'baseline', '00_full_schema.sql');
const COVERAGE_FILE = join(REPO_ROOT, 'migrations', 'baseline', 'SCHEMA_COVERAGE.json');
const EXPECTED_FILE = join(REPO_ROOT, 'docs', 'database', 'EXPECTED_PROD_TABLES.json');

dotenv.config({ path: join(REPO_ROOT, '.env') });

const SQL_SKIP_FILES = new Set([
  'RUN_THIS_NOW.sql',
  'SEED_DATA.sql',
  '02_seed.sql',
  'seed-subscription-types.sql',
  'fix-schema.sql',
]);

const MERGE_PRIORITY = [
  'migrations/manual/01_schema_new1.sql',
  'migrations/auto-generated/Provision_7_04_2026.sql',
  'migrations/auto-generated/1774252896099-qadevxdb-to-finacs_db-migration.sql',
  'migrations/baseline/04_qe_platform_extension.sql',
  'migrations/baseline/05_prod_gap_tables.sql',
];

function loadExpectedTables() {
  const data = JSON.parse(readFileSync(EXPECTED_FILE, 'utf-8'));
  return data.tables.map((t) => t.toLowerCase());
}

function normalizeCreateToIfNotExists(ddl) {
  let sql = ddl.trim();
  if (!/^CREATE\s+TABLE/i.test(sql)) return null;
  sql = sql.replace(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS ');
  if (!sql.endsWith(';')) sql += ';';
  return sql;
}

function extractTableName(ddl) {
  const m = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`']?([^`'\s(]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function extractCreateTablesFromSql(content) {
  const tables = new Map();
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`']?[^`';]+[`']?\s*\([^;]*\)\s*[^;]*;/gis;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const ddl = normalizeCreateToIfNotExists(match[0]);
    if (!ddl) continue;
    const name = extractTableName(ddl);
    if (!name) continue;
    const existing = tables.get(name);
    if (!existing || ddl.length > existing.length) {
      tables.set(name, ddl);
    }
  }
  return tables;
}

function walkSqlFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'scripts') continue;
      walkSqlFiles(full, files);
    } else if (entry.endsWith('.sql') && !SQL_SKIP_FILES.has(entry)) {
      files.push(full);
    }
  }
  return files;
}

function mergeFromRepoSql() {
  const tables = new Map();

  for (const rel of MERGE_PRIORITY) {
    const path = join(REPO_ROOT, rel);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf-8');
    for (const [name, ddl] of extractCreateTablesFromSql(content)) {
      if (!tables.has(name) || ddl.length > tables.get(name).length) {
        tables.set(name, ddl);
      }
    }
  }

  const migrationsRoot = join(REPO_ROOT, 'migrations');
  const allFiles = walkSqlFiles(migrationsRoot).filter(
    (f) => !f.includes(`${join('migrations', 'baseline', '00_full_schema')}`),
  );

  for (const file of allFiles) {
    const content = readFileSync(file, 'utf-8');
    for (const [name, ddl] of extractCreateTablesFromSql(content)) {
      if (!tables.has(name) || ddl.length > tables.get(name).length) {
        tables.set(name, ddl);
      }
    }
  }

  return tables;
}

function getConnectionOptions() {
  const host = process.env.MYSQL_HOST || process.env.SOURCE_MYSQL_HOST;
  const user = process.env.MYSQL_USER || process.env.SOURCE_MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD || process.env.SOURCE_MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE || process.env.SOURCE_MYSQL_DATABASE;
  const port = parseInt(process.env.MYSQL_PORT || process.env.SOURCE_MYSQL_PORT || '3306', 10);

  if (!host || !user || !password || !database) {
    return null;
  }

  const sslEnabled = process.env.MYSQL_SSL !== 'false' && process.env.MYSQL_SSL !== '0';
  return {
    host,
    port,
    user,
    password,
    database,
    ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

async function dumpFromDatabase() {
  const opts = getConnectionOptions();
  if (!opts) return null;

  console.log(`📡 Dumping schema from ${opts.host}/${opts.database} ...`);

  try {
    execSync('mysqldump --version', { stdio: 'ignore' });
    const sslFlag = opts.ssl ? '' : '--ssl-mode=DISABLED';
    const cmd = [
      'mysqldump',
      sslFlag,
      `-h${opts.host}`,
      `-P${opts.port}`,
      `-u${opts.user}`,
      `-p${opts.password}`,
      '--no-data',
      '--skip-add-drop-table',
      '--skip-comments',
      '--set-gtid-purged=OFF',
      opts.database,
    ]
      .filter(Boolean)
      .join(' ');

    let raw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    raw = raw.replace(/^CREATE TABLE `/gm, 'CREATE TABLE IF NOT EXISTS `');
    return { sql: wrapHeader(raw), source: 'mysqldump', tables: null };
  } catch {
    console.log('   mysqldump unavailable or failed — using SHOW CREATE TABLE via mysql2');
  }

  const conn = await mysql.createConnection(opts);
  const tables = new Map();

  try {
    const [rows] = await conn.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [opts.database],
    );

    for (const row of rows) {
      const tableName = row.TABLE_NAME || row.table_name;
      const [createRows] = await conn.query(`SHOW CREATE TABLE \`${tableName.replace(/`/g, '``')}\``);
      const createRow = createRows[0];
      const ddl =
        createRow['Create Table'] ||
        createRow['Create View'] ||
        Object.values(createRow)[1];
      if (!ddl) continue;
      const normalized = normalizeCreateToIfNotExists(String(ddl));
      if (normalized) tables.set(tableName.toLowerCase(), normalized);
    }
  } finally {
    await conn.end();
  }

  return { sql: null, source: 'show-create-table', tables };
}

function wrapHeader(body) {
  return `-- =============================================================================
-- DevX — FULL database schema (all tables, prod parity)
-- Generated: ${new Date().toISOString()}
-- DO NOT EDIT BY HAND — run: node scripts/generate-full-schema-baseline.js
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';

${body}

SET FOREIGN_KEY_CHECKS = 1;
`;
}

function buildSqlFromTableMap(tables, expected) {
  const sorted = [...tables.keys()].sort();
  const body = sorted.map((k) => tables.get(k)).join('\n\n');
  let sql = wrapHeader(body);

  const covered = sorted;
  const missing = expected.filter((t) => !tables.has(t));

  return { sql, covered, missing, tableCount: sorted.length };
}

async function main() {
  const fromDbOnly = process.argv.includes('--from-db-only');
  const expected = loadExpectedTables();

  let result;

  const dbDump = await dumpFromDatabase();
  if (dbDump?.sql) {
    writeFileSync(OUT_FILE, dbDump.sql, 'utf-8');
    const tableCount = (dbDump.sql.match(/CREATE TABLE/gi) || []).length;
    result = {
      source: dbDump.source,
      tableCount,
      missing: expected.filter(
        (t) => !new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?\`${t}\``, 'i').test(dbDump.sql),
      ),
      covered: [],
    };
  } else if (dbDump?.tables) {
    const built = buildSqlFromTableMap(dbDump.tables, expected);
    writeFileSync(OUT_FILE, built.sql, 'utf-8');
    result = {
      source: dbDump.source,
      tableCount: built.tableCount,
      missing: built.missing,
      covered: built.covered,
    };
  } else if (fromDbOnly) {
    console.error('❌ --from-db-only set but MYSQL_* not configured or DB unreachable');
    process.exit(1);
  } else {
    console.log('📦 Merging CREATE TABLE from repository SQL files...');
    const tables = mergeFromRepoSql();
    const built = buildSqlFromTableMap(tables, expected);
    writeFileSync(OUT_FILE, built.sql, 'utf-8');
    result = {
      source: 'repo-merge',
      tableCount: built.tableCount,
      missing: built.missing,
      covered: built.covered,
    };
  }

  writeFileSync(
    COVERAGE_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        outputFile: relative(REPO_ROOT, OUT_FILE),
        source: result.source,
        tableCount: result.tableCount,
        expectedCount: expected.length,
        missingTables: result.missing,
        complete: result.missing.length === 0,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  console.log(`\n✅ Wrote ${relative(REPO_ROOT, OUT_FILE)}`);
  console.log(`   Tables in baseline: ${result.tableCount}`);
  console.log(`   Expected (prod):    ${expected.length}`);
  console.log(`   Missing:            ${result.missing.length}`);

  if (result.missing.length > 0) {
    console.log('\n⚠️  Missing tables (add to 05_prod_gap_tables.sql or run with MYSQL_* for live dump):');
    result.missing.forEach((t) => console.log(`   - ${t}`));
    if (result.source === 'repo-merge') {
      console.log('\n   To get 100% parity: set MYSQL_* in .env and re-run this script.');
    }
  } else {
    console.log('\n🎉 Full prod table coverage.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

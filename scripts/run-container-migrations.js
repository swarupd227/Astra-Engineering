#!/usr/bin/env node
/**
 * Container / CI database migrations.
 * Invoked from docker-entrypoint.sh when RUN_DB_MIGRATIONS=true.
 *
 * Env:
 *   RUN_DB_MIGRATIONS       - must be true/1 (set by entrypoint)
 *   RUN_DB_SEED             - true/1 to apply manual/02_seed.sql
 *   RUN_DB_MIGRATIONS_STRICT - exit 1 on any failed migration file
 *   MYSQL_*                 - database connection (or loaded from AWS Secrets Manager when DEVX_HOSTING=aws)
 *   MYSQL_SSL               - set false to disable SSL (local dev)
 *   MIGRATION_LOAD_AWS_SECRETS - force true/false SM load (default: auto from DEVX_HOSTING)
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadMigrationOrder,
  buildPhasesFromManifest,
  getMysqlConnectionOptions,
  loadAwsSecretsForMigration,
  runMigrationPlan,
  REPO_ROOT,
} from './migration-lib.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(process.env.DEVX_REPO_ROOT || join(__dirname, '..'), '.env') });

async function waitForDatabase(maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mysql.createConnection(getMysqlConnectionOptions());
      await conn.ping();
      await conn.end();
      return;
    } catch (error) {
      console.log(`[migrate] DB not ready (${attempt}/${maxAttempts}): ${error.message}`);
      if (attempt === maxAttempts) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  if (process.env.RUN_DB_MIGRATIONS !== 'true' && process.env.RUN_DB_MIGRATIONS !== '1') {
    console.log('[migrate] RUN_DB_MIGRATIONS not set — skipping');
    return;
  }

  console.log('\n[migrate] DevX database migration (container startup)');
  console.log(`[migrate] Repo root: ${REPO_ROOT}`);

  const strict =
    process.env.RUN_DB_MIGRATIONS_STRICT === 'true' || process.env.RUN_DB_MIGRATIONS_STRICT === '1';

  await loadAwsSecretsForMigration();

  await waitForDatabase();

  const manifest = loadMigrationOrder();
  const phases = buildPhasesFromManifest(manifest);

  const connection = await mysql.createConnection({
    ...getMysqlConnectionOptions(),
    multipleStatements: true,
  });

  try {
    const { successCount, skippedCount, failedCount, totalFiles } = await runMigrationPlan({
      phases,
      connection,
      strict,
    });

    console.log(
      `[migrate] Done — ok=${successCount} skipped=${skippedCount} failed=${failedCount} total=${totalFiles}`,
    );

    if (failedCount > 0 && strict) {
      process.exit(1);
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});

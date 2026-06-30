/**
 * Shared migration runner utilities for CLI and container startup.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const MYSQL_ENV_KEYS = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, '..');
export const MIGRATIONS_ROOT = join(REPO_ROOT, 'migrations');

const IGNORABLE_ERROR_CODES = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY (column/key missing)
]);

const IGNORABLE_MESSAGE_FRAGMENTS = [
  'Duplicate column name',
  'already exists',
  'Duplicate key name',
  "Can't DROP",
  'check that column/key exists',
];

export function isIgnorableSqlError(error) {
  if (!error) return false;
  if (error.errno && IGNORABLE_ERROR_CODES.has(error.errno)) return true;
  const msg = String(error.message || error);
  return IGNORABLE_MESSAGE_FRAGMENTS.some((f) => msg.includes(f));
}

/**
 * Strip line (--) and block (/* *\/) comments before splitting statements.
 * Semicolons inside comments must not become false statement boundaries.
 */
export function stripSqlComments(sqlContent) {
  let result = '';
  let i = 0;
  const len = sqlContent.length;

  while (i < len) {
    const ch = sqlContent[i];
    const next = sqlContent[i + 1];

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len - 1 && !(sqlContent[i] === '*' && sqlContent[i + 1] === '/')) {
        i++;
      }
      i += 2;
      result += ' ';
      continue;
    }

    // Line comment
    if (ch === '-' && next === '-') {
      i += 2;
      while (i < len && sqlContent[i] !== '\n' && sqlContent[i] !== '\r') {
        i++;
      }
      result += '\n';
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      result += ch;
      i++;
      while (i < len) {
        result += sqlContent[i];
        if (sqlContent[i] === "'") {
          if (sqlContent[i + 1] === "'") {
            result += sqlContent[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Double-quoted string
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        result += sqlContent[i];
        if (sqlContent[i] === '"') {
          if (sqlContent[i + 1] === '"') {
            result += sqlContent[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

export function splitSqlStatements(sqlContent) {
  const cleaned = stripSqlComments(sqlContent);
  return cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadMigrationOrder() {
  const manifestPath = join(MIGRATIONS_ROOT, 'migration-order.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing migration manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

export function resolveMigrationPath(relativePath) {
  return join(MIGRATIONS_ROOT, relativePath.replace(/\\/g, '/'));
}

export function hasMysqlEnv() {
  return ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'].every((k) => process.env[k]);
}

/**
 * Whether to fetch MYSQL_* from AWS Secrets Manager before migrating.
 * Default on EKS: DEVX_HOSTING=aws (set by Helm). Disable with MIGRATION_LOAD_AWS_SECRETS=false.
 */
export function shouldLoadAwsSecretsForMigration() {
  const flag = process.env.MIGRATION_LOAD_AWS_SECRETS;
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  return process.env.DEVX_HOSTING === 'aws' || Boolean(process.env.AWS_SECRET_NAME);
}

/**
 * Load secrets from AWS Secrets Manager (same secret as server/secrets-loader.ts).
 * MYSQL_* keys are always overwritten from SM when present — single source of truth on EKS.
 */
export async function loadAwsSecretsForMigration() {
  if (!shouldLoadAwsSecretsForMigration()) {
    console.log('[migrate] Using MYSQL_* from environment / .env (AWS Secrets Manager load skipped)');
    return { loaded: false };
  }

  const secretName = process.env.AWS_SECRET_NAME || 'devx/platform/qa';
  const region = process.env.AWS_REGION || 'ap-south-1';
  const client = new SecretsManagerClient({ region });

  console.log(`[migrate] Loading MYSQL_* from AWS Secrets Manager: "${secretName}" (${region})`);

  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));

    if (!response.SecretString) {
      throw new Error(`Secret "${secretName}" has no string value`);
    }

    const secrets = JSON.parse(response.SecretString.replace(/^\uFEFF/, ''));
    let mysqlUpdated = 0;

    for (const key of MYSQL_ENV_KEYS) {
      if (secrets[key] != null && secrets[key] !== '') {
        process.env[key] = String(secrets[key]);
        mysqlUpdated++;
      }
    }

    if (!hasMysqlEnv()) {
      throw new Error(
        `Secret "${secretName}" loaded but missing required MYSQL_* keys (${MYSQL_ENV_KEYS.join(', ')})`,
      );
    }

    console.log(
      `[migrate] Secrets Manager OK — ${mysqlUpdated} MYSQL_* key(s) applied → ` +
        `${process.env.MYSQL_USER}@${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || '3306'}/${process.env.MYSQL_DATABASE}`,
    );
    return { loaded: true, secretName };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (hasMysqlEnv()) {
      console.warn(
        `[migrate] Secrets Manager unavailable (${message}) — falling back to MYSQL_* from Kubernetes secret / env`,
      );
      return { loaded: false, fallback: true };
    }
    throw new Error(
      `[migrate] Cannot load MYSQL_* from Secrets Manager and none in environment: ${message}`,
    );
  }
}

export function getMysqlConnectionOptions() {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  const sslEnabled = process.env.MYSQL_SSL !== 'false' && process.env.MYSQL_SSL !== '0';
  const options = {
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: false,
  };

  if (sslEnabled) {
    options.ssl = { rejectUnauthorized: false };
  }

  return options;
}

export function migrationTrackingName(relativePath) {
  return relativePath.replace(/\\/g, '/').replace(/\.sql$/i, '');
}

export class MigrationRunner {
  constructor(connection) {
    this.connection = connection;
  }

  async ensureMigrationsTable() {
    await this.connection.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INT,
        status ENUM('success', 'failed', 'rolled_back') DEFAULT 'success',
        error_message TEXT,
        INDEX idx_migration_name (migration_name),
        INDEX idx_executed_at (executed_at),
        INDEX idx_status (status)
      )
    `);
  }

  async isMigrationCompleted(name) {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM schema_migrations WHERE migration_name = ? AND status = 'success' LIMIT 1`,
      [name],
    );
    return rows.length > 0;
  }

  async recordMigration(name, executionTime, status, errorMessage = null) {
    await this.connection.execute(
      `INSERT INTO schema_migrations
       (migration_name, execution_time_ms, status, error_message)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         executed_at = CURRENT_TIMESTAMP,
         execution_time_ms = VALUES(execution_time_ms),
         status = VALUES(status),
         error_message = VALUES(error_message)`,
      [name, executionTime, status, errorMessage],
    );
  }

  splitSqlStatements(sqlContent) {
    return splitSqlStatements(sqlContent);
  }

  async executeWholeFile(migrationName, sqlContent, { ignoreExists = true } = {}) {
    const startTime = Date.now();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📦 Migration (multi-statement): ${migrationName}`);
    console.log(`${'='.repeat(80)}\n`);

    if (await this.isMigrationCompleted(migrationName)) {
      console.log('⏭️  Already completed. Skipping...\n');
      return { skipped: true };
    }

    try {
      // createPool has getConnection(); createConnection does not
      if (typeof this.connection.getConnection === 'function') {
        const conn = await this.connection.getConnection();
        try {
          await conn.query({ sql: sqlContent, timeout: 600_000 });
        } finally {
          conn.release();
        }
      } else {
        await this.connection.query({ sql: sqlContent, timeout: 600_000 });
      }

      const executionTime = Date.now() - startTime;
      await this.recordMigration(migrationName, executionTime, 'success');
      console.log(`✅ Completed in ${executionTime}ms\n`);
      return { success: true, executionTime };
    } catch (error) {
      if (ignoreExists && isIgnorableSqlError(error)) {
        const executionTime = Date.now() - startTime;
        await this.recordMigration(migrationName, executionTime, 'success');
        console.log(`⏭️  Completed with ignorable errors: ${error.message}\n`);
        return { success: true, executionTime, partial: true };
      }

      const executionTime = Date.now() - startTime;
      await this.recordMigration(migrationName, executionTime, 'failed', error.message);
      console.error(`❌ Failed: ${error.message}\n`);
      return { failed: true, error: error.message };
    }
  }

  async executeMigrationFile(relativePath, sqlContent, options = {}) {
    const migrationName = migrationTrackingName(relativePath);
    const mode = options.mode || 'statements';
    const ignoreExists = options.ignoreExists !== false;

    if (mode === 'multiStatement' || mode === 'wholeFile') {
      return this.executeWholeFile(migrationName, sqlContent, { ignoreExists });
    }

    const startTime = Date.now();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📦 Migration: ${migrationName}`);
    console.log(`${'='.repeat(80)}\n`);

    if (await this.isMigrationCompleted(migrationName)) {
      console.log('⏭️  Already completed. Skipping...\n');
      return { skipped: true };
    }

    const statements = this.splitSqlStatements(sqlContent);
    if (statements.length === 0) {
      console.log('⚠️  No executable statements found. Skipping...\n');
      return { skipped: true };
    }

    console.log(`🔧 Executing ${statements.length} statement(s)...\n`);

    try {
      await this.connection.beginTransaction();
      try {
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i];
          console.log(`  ${i + 1}/${statements.length} Executing...`);
          try {
            // query() — not execute() — supports DDL, PREPARE/EXECUTE, USE, SET, etc.
            await this.connection.query(stmt);
            console.log(`  ✅ Statement ${i + 1} completed`);
          } catch (stmtError) {
            if (ignoreExists && isIgnorableSqlError(stmtError)) {
              console.log(`  ⏭️  Statement ${i + 1} skipped (${stmtError.message})`);
            } else {
              throw stmtError;
            }
          }
        }
        await this.connection.commit();
      } catch (error) {
        await this.connection.rollback();
        throw error;
      }

      const executionTime = Date.now() - startTime;
      await this.recordMigration(migrationName, executionTime, 'success');
      console.log(`\n✅ Migration completed in ${executionTime}ms\n`);
      return { success: true, executionTime };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.recordMigration(migrationName, executionTime, 'failed', error.message);
      console.error(`\n❌ Migration failed: ${error.message}\n`);
      return { failed: true, error: error.message };
    }
  }

  async showMigrationHistory(limit = 20) {
    console.log('\n📊 Migration History:');
    console.log('─'.repeat(120));
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const [migrations] = await this.connection.query(
      `SELECT migration_name,
              DATE_FORMAT(executed_at, '%Y-%m-%d %H:%i:%s') AS executed_at,
              execution_time_ms,
              status
       FROM schema_migrations
       ORDER BY executed_at DESC
       LIMIT ${safeLimit}`,
    );
    if (migrations.length === 0) {
      console.log('No migrations recorded yet.\n');
    } else {
      console.table(migrations);
    }
  }
}

export async function runMigrationPlan({ phases, connection, strict = false }) {
  const runner = new MigrationRunner(connection);
  await runner.ensureMigrationsTable();

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const totalFiles = phases.reduce((n, p) => n + p.files.length, 0);

  for (const phase of phases) {
    console.log(`\n🔷 Phase: ${phase.name}${phase.description ? ` — ${phase.description}` : ''}\n`);

    for (const fileEntry of phase.files) {
      const relativePath = typeof fileEntry === 'string' ? fileEntry : fileEntry.path;
      const filepath = resolveMigrationPath(relativePath);
      if (!existsSync(filepath)) {
        console.warn(`⚠️  Missing file, skipping: ${relativePath}`);
        skippedCount++;
        continue;
      }

      const sqlContent = readFileSync(filepath, 'utf-8');
      const fileOptions = {
        mode: phase.mode || 'statements',
        ignoreExists: phase.ignoreExists !== false,
        ...(typeof fileEntry === 'object' ? fileEntry.options : {}),
      };

      const result = await runner.executeMigrationFile(relativePath, sqlContent, fileOptions);
      if (result.skipped) skippedCount++;
      else if (result.success) successCount++;
      else if (result.failed) {
        failedCount++;
        if (phase.strict) {
          throw new Error(`Migration failed: ${relativePath} — ${result.error}`);
        }
        console.error('⚠️  Continuing after failure (non-strict phase)...\n');
      }
    }
  }

  return { runner, successCount, skippedCount, failedCount, totalFiles };
}

export function buildPhasesFromManifest(manifest, env = process.env) {
  const phases = [];

  for (const phase of manifest.phases) {
    if (phase.env && env[phase.env] !== 'true' && env[phase.env] !== '1') {
      if (phase.optional) {
        console.log(`⏭️  Skipping optional phase "${phase.name}" (${phase.env} not set)`);
        continue;
      }
    }

    phases.push({
      name: phase.name,
      description: phase.description,
      mode: phase.mode || 'statements',
      ignoreExists: phase.ignoreExists,
      strict: phase.strict,
      files: phase.files.map((f) => (typeof f === 'string' ? f : f)),
    });
  }

  return phases;
}

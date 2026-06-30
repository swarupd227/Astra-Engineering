import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@shared/qe-schema";

// Use `ReturnType<typeof drizzle>` (without the schema generic) to match the
// pattern used by server/db.ts. Pinning the schema generic on the type alias
// produces a different `$client` Pool type than the actual call returns,
// which TypeScript flags as "two different types with this name". Looser
// typing here is safe — call sites still get full schema-aware types via
// the drizzle query API (e.g. `db.select().from(schema.x)`).
type QEDatabase = ReturnType<typeof drizzle>;

function resolveConnectionUrl(): string | undefined {
  if (process.env.QE_DATABASE_URL) {
    return process.env.QE_DATABASE_URL;
  }

  const natHost = process.env.NAT_MYSQL_HOST;
  const natUser = process.env.NAT_MYSQL_USER;
  const natPassword = process.env.NAT_MYSQL_PASSWORD;
  const natDatabase = process.env.NAT_MYSQL_DATABASE;
  if (natHost && natUser && natPassword && natDatabase) {
    const port = process.env.NAT_MYSQL_PORT || "3306";
    return `mysql://${natUser}:${natPassword}@${natHost}:${port}/${natDatabase}`;
  }

  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;
  if (host && user && password && database) {
    const port = process.env.MYSQL_PORT || "3306";
    return `mysql://${user}:${password}@${host}:${port}/${database}`;
  }

  return undefined;
}

let _pool: mysql.Pool | undefined;
let _db: QEDatabase | undefined;
let _initialized = false;
let _initAttempted = false;
let _migrationsReady: Promise<void> = Promise.resolve();

/**
 * Lazily resolve the connection URL and create the pool on first access.
 *
 * This runs at first DB access rather than at module load so it picks up
 * env vars that are populated by AWS Secrets Manager after import time.
 * In server/index.ts the QE modules are statically imported at the top,
 * which means qe/db.ts evaluates BEFORE loadSecrets() has injected
 * MYSQL_HOST/USER/PASSWORD/DATABASE etc. into process.env. Eager init
 * would freeze _db = undefined and every subsequent request would 500
 * with "QE database is not available". Deferring to first access avoids
 * that ordering trap and works for both DEVX_HOSTING=azure (env from
 * .env) and DEVX_HOSTING=aws (env from Secrets Manager).
 */
function ensureInit(): void {
  if (_initialized) return;
  const connectionUrl = resolveConnectionUrl();
  if (!connectionUrl) {
    if (!_initAttempted) {
      console.log(
        "[QE] Database is not available — no QE_DATABASE_URL, NAT_MYSQL_*, or MYSQL_* environment variables set yet",
      );
      _initAttempted = true;
    }
    return;
  }

  const pool = mysql.createPool({ uri: connectionUrl });
  _pool = pool;
  _db = drizzle(pool, { schema, mode: "default" });
  _initialized = true;
  console.log("[QE] Database connection configured successfully");

  // Kick off schema migration immediately (was previously delayed 5s, which
  // raced with seedDemoDataIfEmpty() and caused first-boot ER_BAD_FIELD_ERROR
  // on tables that hadn't yet been ALTERed). Callers that depend on the
  // migrated columns being present should `await awaitMigrations()`.
  _migrationsReady = runSchemaMigration();
}

async function runSchemaMigration(): Promise<void> {
  try {
      // The canonical way to set up / update the QE database is `node sync-schema.cjs`,
      // which can both CREATE TABLE and ALTER TABLE ADD COLUMN idempotently. This
      // runtime migrator is a defence-in-depth backstop for ALTER TABLE ADD COLUMN
      // only — it picks up missing columns when someone has skipped sync-schema.cjs
      // and is pointing at a stale QE database (typically the AWS Aurora QE DB
      // that was set up from an older snapshot of qe-schema.ts).
      //
      // NOTE: columns that are NOT NULL in the Drizzle schema are intentionally
      // declared NULLABLE here (e.g. user_id) because existing rows on the
      // database pre-date the schema change and would violate a NOT NULL
      // constraint added retroactively. Drizzle applies these defaults
      // client-side at insert time, so the DB column doesn't strictly need them.
      // If the hard NOT NULL is ever needed, run a one-off SQL pass to backfill
      // existing rows first.
      const migrations: Record<string, string[]> = {
        users: [
          "username TEXT",
          "password TEXT",
        ],
        projects: [
          "user_id VARCHAR(255)",
          "domain TEXT",
          "product_description TEXT",
          "website_url TEXT",
          "application_type TEXT",
          "ado_enabled INT DEFAULT 0",
          "ado_connection_id VARCHAR(255)",
          "ado_project_id TEXT",
          "ado_project_name TEXT",
          "devx_sdlc_project_id VARCHAR(255)",
          "devx_sdlc_project_name VARCHAR(255)",
          "devx_ado_organization VARCHAR(255)",
          "golden_repo_id VARCHAR(255)",
          "golden_repo_name VARCHAR(255)",
        ],
        sprints: [
          "description TEXT",
          "goal TEXT",
          "start_date TIMESTAMP NULL",
          "end_date TIMESTAMP NULL",
          "status TEXT",
          "ado_sync_enabled INT DEFAULT 0",
          "ado_backlog_source TEXT",
          "ado_iteration_path TEXT",
          "ado_area_path TEXT",
          "ado_wiql_query TEXT",
          "ado_work_item_types JSON",
          "ado_sync_frequency TEXT",
          "ado_last_sync_at TIMESTAMP NULL",
          "ado_sync_status TEXT",
          "updated_at TIMESTAMP NULL",
        ],
        sprint_user_stories: [
        "ado_work_item_id INT",
        "story_points INT",
        "priority TEXT",
        "status TEXT",
        "source TEXT",
        "assigned_to TEXT",
        "tags JSON",
        "ado_url TEXT",
        "ado_sync_status TEXT",
        "ado_last_sync_at TIMESTAMP NULL",
        "attachments JSON",
        "additional_context TEXT",
        "context_documents JSON",
        "context_urls JSON",
        "generated_test_cases JSON",
        "test_case_count INT DEFAULT 0",
        "generated_at TIMESTAMP NULL",
      ],
    };
    for (const [table, columns] of Object.entries(migrations)) {
      for (const col of columns) {
        try {
          await _pool!.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${col}`);
          console.log(`[QE] Added column ${table}.${col.split(" ")[0]}`);
        } catch (e: any) {
          if (e.code === "ER_DUP_FIELDNAME") continue;
        }
      }
    }
    console.log("[QE] Schema migration complete");
  } catch (e) {
    console.warn("[QE] Migration skipped:", (e as Error).message);
  }
}

/**
 * Resolves once the runtime ALTER TABLE migrations finish. Code that runs
 * during startup AND depends on migrated columns being present (e.g. the
 * demo-data seeder which selects `user_id`) should `await` this before
 * issuing its first query, otherwise it'll race the migration and crash
 * with ER_BAD_FIELD_ERROR on a fresh QE database.
 */
export function awaitMigrations(): Promise<void> {
  ensureInit();
  return _migrationsReady;
}

export function isQEDatabaseAvailable(): boolean {
  ensureInit();
  return !!_db;
}

export function getDb(): QEDatabase {
  ensureInit();
  if (!_db) {
    throw new Error(
      "QE database is not available. Set QE_DATABASE_URL or the appropriate MYSQL_* environment variables.",
    );
  }
  return _db;
}

export const db: QEDatabase = new Proxy({} as QEDatabase, {
  get(_target, prop, receiver) {
    ensureInit();
    if (!_db) {
      throw new Error(
        `QE database is not available (accessed property "${String(prop)}"). ` +
          "Set QE_DATABASE_URL or the appropriate MYSQL_* environment variables.",
      );
    }
    return Reflect.get(_db, prop, receiver);
  },
});

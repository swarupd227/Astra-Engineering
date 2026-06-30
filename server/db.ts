import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@shared/schema";

let _pool: mysql.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;
let _initialized = false;

function isEnabled(value: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getMissingEnvMessage(key: string): string {
  const hosting = String(process.env.DEVX_HOSTING || "azure").trim().toLowerCase();
  const useLocalDb = isEnabled(process.env.DEVX_USE_LOCAL_DB);

  if (hosting === "aws" && !useLocalDb) {
    return `${key} environment variable is required. DEVX_HOSTING=aws and DEVX_USE_LOCAL_DB=false, so MYSQL_* must be loaded from AWS Secrets Manager secret "${process.env.AWS_SECRET_NAME || "devx/platform/qa"}" in region "${process.env.AWS_REGION || "ap-south-1"}". Check AWS credentials/IAM access and confirm the secret contains ${key}.`;
  }

  if (useLocalDb) {
    return `${key} environment variable is required. DEVX_USE_LOCAL_DB=true, so set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE in .env for your local database.`;
  }

  return `${key} environment variable is required. Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE in your deployment environment or .env file.`;
}

function getConfig() {
  if (!process.env.MYSQL_HOST) {
    throw new Error(getMissingEnvMessage("MYSQL_HOST"));
  }
  if (!process.env.MYSQL_USER) {
    throw new Error(getMissingEnvMessage("MYSQL_USER"));
  }
  if (!process.env.MYSQL_PASSWORD) {
    throw new Error(getMissingEnvMessage("MYSQL_PASSWORD"));
  }
  if (!process.env.MYSQL_DATABASE) {
    throw new Error(getMissingEnvMessage("MYSQL_DATABASE"));
  }
  return {
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  };
}

/**
 * Lazily creates the MySQL pool on first access so AWS Secrets Manager can
 * populate env before the pool is created.
 */
export function getPool(): mysql.Pool {
  if (!_pool) {
    const config = getConfig();
    _pool = mysql.createPool({
      ...config,
      charset: "utf8mb4_0900_ai_ci",
      ssl: {
        rejectUnauthorized: false,
      },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return _pool;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getPool(), { schema, mode: "default" });
  }
  return _db;
}

export const poolConnection = new Proxy({} as mysql.Pool, {
  get(_target, prop, receiver) {
    return Reflect.get(getPool(), prop, receiver);
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

async function ensureTokenUsageLogsTable(): Promise<void> {
  const createTable = `
    CREATE TABLE IF NOT EXISTS token_usage_logs (
      id CHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      tokens_consumed BIGINT NOT NULL,
      model_name VARCHAR(100) NOT NULL DEFAULT 'BRD_STANDARD_COST',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      INDEX idx_token_usage_logs_tenant_id (tenant_id),
      INDEX idx_token_usage_logs_user_id (user_id),
      INDEX idx_token_usage_logs_created_at (created_at)
    )
  `;
  try {
    await getPool().query(createTable);
  } catch (e: any) {
    console.warn("[db] ensureTokenUsageLogsTable:", e?.message || e);
  }
}

async function ensureProjectGitConfigTable(): Promise<void> {
  const createTable = `
    CREATE TABLE IF NOT EXISTS project_git_config (
      id CHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      provider ENUM('github', 'ado') NOT NULL DEFAULT 'ado',
      branch VARCHAR(255) NOT NULL DEFAULT 'main',
      base_path VARCHAR(512),
      ado_repository_id VARCHAR(36),
      ado_repository_name VARCHAR(255),
      token TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
    )
  `;
  try {
    await getPool().query(createTable);
  } catch (e: any) {
    console.warn("[db] ensureProjectGitConfigTable (create table):", e?.message || e);
    return;
  }
  try {
    await getPool().query(
      "CREATE INDEX IF NOT EXISTS idx_project_git_config_project_id ON project_git_config(project_id)"
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_KEYNAME" || e?.errno === 1061) {
      return;
    }
    try {
      await getPool().query(
        "CREATE INDEX idx_project_git_config_project_id ON project_git_config(project_id)"
      );
    } catch (e2: any) {
      if (e2?.code === "ER_DUP_KEYNAME" || e2?.errno === 1061) {
        return;
      }
      console.warn("[db] ensureProjectGitConfigTable (index):", e2?.message || e2);
    }
  }
}

async function ensureArtifactEventsTable(): Promise<void> {
  const createTable = `
    CREATE TABLE IF NOT EXISTS artifact_events (
      id CHAR(36) PRIMARY KEY,
      artifact_id VARCHAR(100),
      use_case VARCHAR(50),
      user_id VARCHAR(100),
      project_id VARCHAR(100),
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tokens_used INT,
      processing_time_ms INT,
      INDEX idx_artifact_events_use_case (use_case),
      INDEX idx_artifact_events_created_at (created_at)
    )
  `;
  try {
    await getPool().query(createTable);
  } catch (e: any) {
    console.warn("[db] ensureArtifactEventsTable:", e?.message || e);
  }
}

/**
 * Polaris AI-metrics tables (additive). Source of truth DDL for the
 * universal AI usage ledger + JIRA mapping + productivity targets.
 * Idempotent CREATE TABLE IF NOT EXISTS; never alters existing tables.
 */
async function ensurePolarisMetricsTables(): Promise<void> {
  const ddls: Record<string, string> = {
    universal_ai_usage_logs: `
      CREATE TABLE IF NOT EXISTS universal_ai_usage_logs (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) DEFAULT NULL,
        tenant_id VARCHAR(36) DEFAULT NULL,
        team_id VARCHAR(100) DEFAULT NULL,
        project_id VARCHAR(100) DEFAULT NULL,
        session_id VARCHAR(36) DEFAULT NULL,
        correlation_id VARCHAR(36) DEFAULT NULL,
        provider VARCHAR(50) NOT NULL DEFAULT 'claude',
        model_name VARCHAR(255) NOT NULL,
        feature_name VARCHAR(100) DEFAULT NULL,
        use_case VARCHAR(100) DEFAULT NULL,
        request_status VARCHAR(20) NOT NULL DEFAULT 'success',
        quality_decision VARCHAR(20) NOT NULL DEFAULT 'unrated',
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        cache_tokens INT NOT NULL DEFAULT 0,
        total_tokens INT NOT NULL DEFAULT 0,
        cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        latency_ms INT DEFAULT NULL,
        request_metadata JSON DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_uaiul_user_created (user_id, created_at),
        KEY idx_uaiul_provider_created (provider, created_at),
        KEY idx_uaiul_usecase_created (use_case, created_at),
        KEY idx_uaiul_created (created_at),
        KEY idx_uaiul_quality (quality_decision),
        KEY idx_uaiul_correlation (correlation_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    jira_team_members: `
      CREATE TABLE IF NOT EXISTS jira_team_members (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) DEFAULT NULL,
        jira_account_id VARCHAR(128) NOT NULL,
        jira_display_name VARCHAR(255) DEFAULT NULL,
        jira_email VARCHAR(255) DEFAULT NULL,
        instance_url VARCHAR(500) NOT NULL,
        project_id VARCHAR(36) DEFAULT NULL,
        project_key VARCHAR(100) NOT NULL,
        project_name VARCHAR(255) DEFAULT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        match_method VARCHAR(20) NOT NULL DEFAULT 'unmatched',
        match_confidence DECIMAL(4,3) DEFAULT NULL,
        synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_jtm_natural (instance_url(191), project_key, jira_account_id),
        KEY idx_jtm_user (user_id),
        KEY idx_jtm_project (project_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    jira_user_overrides: `
      CREATE TABLE IF NOT EXISTS jira_user_overrides (
        id VARCHAR(36) NOT NULL,
        instance_url VARCHAR(500) NOT NULL,
        jira_account_id VARCHAR(128) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        created_by VARCHAR(36) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_juo (instance_url(191), jira_account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    productivity_targets: `
      CREATE TABLE IF NOT EXISTS productivity_targets (
        id VARCHAR(36) NOT NULL,
        period_type VARCHAR(20) NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        target_saved_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_pt_period (period_type, period_start, period_end)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  };
  for (const [table, ddl] of Object.entries(ddls)) {
    try {
      await getPool().query(ddl);
    } catch (e: any) {
      console.warn(`[db] ensurePolarisMetricsTables (${table}):`, e?.message || e);
    }
  }
  console.log("✓ Polaris AI-metrics tables ready");
}

async function ensureTestingTablesExist(): Promise<void> {
  const alterTableAdoId = `
    ALTER TABLE test_plan_documents ADD COLUMN ado_id VARCHAR(50) AFTER created_by
  `;
  try {
    const [rows]: any = await getPool().query(`
      SELECT COUNT(*) as count 
      FROM information_schema.columns 
      WHERE table_name = 'test_plan_documents' 
      AND column_name = 'ado_id' 
      AND table_schema = DATABASE()
    `);

    if (rows[0].count === 0) {
      console.log("[db] Adding ado_id column to test_plan_documents table...");
      await getPool().query(alterTableAdoId);
      console.log("[db] ✓ ado_id column added successfully");
    }

    const [orgRows]: any = await getPool().query(`
      SELECT COUNT(*) as count 
      FROM information_schema.columns 
      WHERE table_name = 'test_plan_documents' 
      AND column_name = 'ado_org' 
      AND table_schema = DATABASE()
    `);
    if (orgRows[0].count === 0) {
      await getPool().query(
        "ALTER TABLE test_plan_documents ADD COLUMN ado_org VARCHAR(255) AFTER ado_id"
      );
      console.log("[db] ✓ ado_org column added successfully");
    }

    const [projRows]: any = await getPool().query(`
      SELECT COUNT(*) as count 
      FROM information_schema.columns 
      WHERE table_name = 'test_plan_documents' 
      AND column_name = 'ado_project' 
      AND table_schema = DATABASE()
    `);
    if (projRows[0].count === 0) {
      await getPool().query(
        "ALTER TABLE test_plan_documents ADD COLUMN ado_project VARCHAR(255) AFTER ado_org"
      );
      console.log("[db] ✓ ado_project column added successfully");
    }

    const [delRows]: any = await getPool().query(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'test_plan_documents'
      AND column_name = 'deleted_at'
      AND table_schema = DATABASE()
    `);
    if (delRows[0].count === 0) {
      await getPool().query(
        "ALTER TABLE test_plan_documents ADD COLUMN deleted_at TIMESTAMP NULL AFTER ado_project"
      );
      console.log("[db] ✓ deleted_at column added successfully");
    }

    const [statusRows]: any = await getPool().query(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'test_plan_documents'
      AND column_name = 'status'
      AND table_schema = DATABASE()
    `);
    if (statusRows[0].count === 0) {
      await getPool().query(
        "ALTER TABLE test_plan_documents ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'active' AFTER content"
      );
      console.log("[db] ✓ status column added to test_plan_documents");
    }
  } catch (e: any) {
    if (e?.errno !== 1060) {
      console.warn("[db] ensureTestingTablesExist:", e?.message || e);
    }
  }
}

/**
 * Verify that critical tables exist and log warnings for any that are missing.
 */
async function verifyCriticalTables(): Promise<void> {
  const critical = [
    "tenants", "users", "roles", "user_roles", "organizations",
    "subscription_types", "subscriptions",
    "sdlc_projects", "sdlc_phases", "jira_connections", "jira_settings",
    "workflow_artifacts", "workflow_test_cases",
    "artifact_organizations", "integration_settings",
  ];
  try {
    const [rows]: any = await getPool().query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    );
    const existing = new Set((rows as any[]).map((r: any) => r.TABLE_NAME));
    const missing = critical.filter((t) => !existing.has(t));
    if (missing.length > 0) {
      console.warn(`⚠ Missing critical tables: ${missing.join(", ")}`);
      console.warn(`  Run: npx tsx scripts/ensure-db-schema.ts`);
    } else {
      console.log(`✓ All ${critical.length} critical tables present`);
    }
  } catch (e: any) {
    console.warn("[db] verifyCriticalTables:", e?.message || e);
  }
}

/**
 * Seed default roles if the roles table is empty or missing key IDs.
 */
async function seedDefaultRoles(): Promise<void> {
  try {
    const [rows]: any = await getPool().query(`SELECT COUNT(*) as cnt FROM roles`);
    if (rows[0].cnt > 0) return;
    const [cols]: any = await getPool().query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles'`
    );
    const colNames = new Set((cols as any[]).map((c: any) => c.COLUMN_NAME));
    if (colNames.has("description")) {
      await getPool().query(`INSERT IGNORE INTO roles (id, name, description) VALUES (1, 'TenantAdmin', 'Full admin'), (2, 'OrgAdmin', 'Org admin'), (3, 'Viewer', 'Read-only')`);
    } else {
      await getPool().query(`INSERT IGNORE INTO roles (id, name) VALUES (1, 'TenantAdmin'), (2, 'OrgAdmin'), (3, 'Viewer')`);
    }
    console.log("✓ Default roles seeded");
  } catch (e: any) {
    console.warn("[db] seedDefaultRoles:", e?.message || e);
  }
}

/**
 * Seed default subscription type — always ensures 'DEFAULT' exists.
 * INSERT IGNORE safely skips if the row already exists.
 */
async function seedDefaultSubscriptionTypes(): Promise<void> {
  try {
    const [result]: any = await getPool().query(
      `INSERT INTO subscription_types (id, code, name, description, is_active)
       VALUES (UUID(), 'DEFAULT', 'Default Subscription', 'Initial subscription with all DevX features enabled', 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         is_active = VALUES(is_active)`
    );
    if (result?.affectedRows > 0) {
      console.log("✓ Default subscription_types seeded");
    } else {
      console.log("✓ Default subscription_types already exists");
    }
  } catch (e: any) {
    console.warn("[db] seedDefaultSubscriptionTypes:", e?.message || e);
  }
}

const DEFAULT_TOKEN_QUOTA = 1_000_000_000;

/**
 * Fix subscriptions at startup:
 * 1. Update any active subscription with token_quota = 0 to the default.
 * 2. Create a subscription for every tenant that has none (orphan fix).
 */
async function fixAndCreateSubscriptions(): Promise<void> {
  const pool = getPool();

  // Step 1: fix existing zero-quota subscriptions
  try {
    const [result]: any = await pool.query(
      `UPDATE subscriptions SET token_quota = ? WHERE is_active = 1 AND (token_quota IS NULL OR token_quota = 0)`,
      [DEFAULT_TOKEN_QUOTA]
    );
    const affected = result?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`✓ Fixed ${affected} subscription(s) with zero token quota → ${DEFAULT_TOKEN_QUOTA.toLocaleString()}`);
    }
  } catch (e: any) {
    console.warn("[db] fixZeroQuotaSubscriptions:", e?.message || e);
  }

  // Step 2: find tenants with NO active subscription and create one
  try {
    const [typeRows]: any = await pool.query(
      `SELECT id FROM subscription_types WHERE code = 'DEFAULT' LIMIT 1`
    );
    const subscriptionTypeId = typeRows?.[0]?.id != null ? String(typeRows[0].id) : "0";

    const [orphans]: any = await pool.query(
      `SELECT t.id AS tenant_id FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.is_active = 1
       WHERE s.id IS NULL`
    );

    const orphanList = orphans as { tenant_id: string }[];
    if (orphanList.length === 0) {
      console.log("✓ All tenants have active subscriptions");
      return;
    }

    console.log(`[db] Found ${orphanList.length} tenant(s) without subscription — creating now...`);
    const now = new Date();
    const expiry = new Date(now);
    expiry.setFullYear(expiry.getFullYear() + 1);

    for (const row of orphanList) {
      try {
        await pool.query(
          `INSERT INTO subscriptions (id, tenant_id, subscription_type_id, max_users, token_quota, token_used, start_date, expiry_date, is_active, created_at)
           VALUES (UUID(), ?, ?, 50, ?, 0, ?, ?, 1, NOW())`,
          [row.tenant_id, subscriptionTypeId, DEFAULT_TOKEN_QUOTA, now, expiry]
        );
        console.log(`  ✓ Created subscription for tenant ${row.tenant_id}`);
      } catch (insertErr: any) {
        if (insertErr?.errno === 1062 || insertErr?.code === "ER_DUP_ENTRY") continue;
        console.warn(`  ✗ Failed to create subscription for tenant ${row.tenant_id}:`, insertErr?.message);
      }
    }
    console.log(`✓ Subscription creation complete for ${orphanList.length} orphaned tenant(s)`);
  } catch (e: any) {
    console.warn("[db] ensureAllTenantsHaveSubscriptions:", e?.message || e);
  }
}

/**
 * Auto-create tables and columns that may be missing after a hosting switch.
 * Runs CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN so it's idempotent.
 */
async function ensureCrossPlatformSchema(): Promise<void> {
  const pool = getPool();

  const tableDDLs: Record<string, string> = {
    tenants: `
      CREATE TABLE IF NOT EXISTS tenants (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    subscription_types: `
      CREATE TABLE IF NOT EXISTS subscription_types (
        id VARCHAR(36) PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    subscriptions: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        subscription_type_id VARCHAR(36) NOT NULL,
        max_users INT NOT NULL DEFAULT 50,
        token_quota BIGINT NOT NULL DEFAULT 0,
        token_used BIGINT NOT NULL DEFAULT 0,
        start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expiry_date TIMESTAMP NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    users: `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        azure_oid VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        tenant_id VARCHAR(36),
        provider VARCHAR(50),
        provider_user_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        token_quota INT NOT NULL DEFAULT 0,
        token_used INT NOT NULL DEFAULT 0,
        mfa_secret VARCHAR(255),
        is_mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
        onboarding_completed_at TIMESTAMP NULL
      )`,
    roles: `
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE
      )`,
    user_roles: `
      CREATE TABLE IF NOT EXISTS user_roles (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        role_id INT NOT NULL,
        scope_type ENUM('org', 'project') NOT NULL,
        scope_id VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        created_by VARCHAR(36)
      )`,
    audit_logs: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(36) PRIMARY KEY,
        actor_user_id VARCHAR(36) NOT NULL,
        target_user_id VARCHAR(36) NOT NULL,
        action ENUM('ROLE_ASSIGNED', 'ROLE_REMOVED', 'USER_SOFT_DELETED') NOT NULL,
        role VARCHAR(50) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        project_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    role_activity_permissions: `
      CREATE TABLE IF NOT EXISTS role_activity_permissions (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        role_id INT NOT NULL,
        activity_key VARCHAR(255) NOT NULL,
        enabled TINYINT(1) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY role_activity_permissions_tenant_provider_role_activity (
          tenant_id,
          provider,
          role_id,
          activity_key
        )
      )`,
    organizations: `
      CREATE TABLE IF NOT EXISTS organizations (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        owner_user_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    projects: `
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(36) PRIMARY KEY,
        organization_id VARCHAR(36),
        name TEXT NOT NULL,
        description TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        type VARCHAR(50) NOT NULL DEFAULT 'development',
        owner_user_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )`,
    jira_connections: `
      CREATE TABLE IF NOT EXISTS jira_connections (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        instance_url TEXT NOT NULL,
        email VARCHAR(255),
        api_token_encrypted TEXT,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_admin_connection TINYINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
    integration_tool_catalog: `
      CREATE TABLE IF NOT EXISTS integration_tool_catalog (
        id VARCHAR(36) PRIMARY KEY,
        category_key VARCHAR(100) NOT NULL,
        provider_key VARCHAR(100) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        supports_testing TINYINT(1) NOT NULL DEFAULT 1,
        required_fields JSON NOT NULL,
        test_config JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY ux_catalog_category_provider (category_key, provider_key)
      )`,
    org_integration_configs: `
      CREATE TABLE IF NOT EXISTS org_integration_configs (
        id VARCHAR(36) PRIMARY KEY,
        org_type VARCHAR(50) NOT NULL,
        org_id VARCHAR(36) NOT NULL,
        tool_catalog_id VARCHAR(36) NOT NULL,
        config JSON NOT NULL,
        secrets_encrypted LONGTEXT NULL,
        last_test_status VARCHAR(20) DEFAULT 'untested',
        last_test_message TEXT NULL,
        last_tested_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )`,
    project_integration_configs: `
      CREATE TABLE IF NOT EXISTS project_integration_configs (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL,
        category_key VARCHAR(100) NOT NULL,
        use_org_default TINYINT(1) NOT NULL DEFAULT 1,
        org_integration_config_id VARCHAR(36) NULL,
        tool_catalog_id VARCHAR(36) NULL,
        config JSON NULL,
        secrets_encrypted LONGTEXT NULL,
        last_test_status VARCHAR(20) DEFAULT 'untested',
        last_test_message TEXT NULL,
        last_tested_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY ux_project_category (project_id, category_key)
      )`,
    integration_settings: `
      CREATE TABLE IF NOT EXISTS integration_settings (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL,
        integration_type VARCHAR(50) NOT NULL DEFAULT 'ado',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uq_integration_project (project_id)
      )`,
    integrations: `
      CREATE TABLE IF NOT EXISTS integrations (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        integration_type VARCHAR(50) NOT NULL,
        api_key VARCHAR(255) NOT NULL,
        app_key VARCHAR(255) NULL,
        base_url VARCHAR(255) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )`,
    ai_enhance_mappings: `
      CREATE TABLE IF NOT EXISTS ai_enhance_mappings (
        id VARCHAR(36) PRIMARY KEY,
        location_key VARCHAR(255) NOT NULL,
        repository_id VARCHAR(36) NOT NULL,
        folder_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_ai_enhance_mappings_location_key (location_key)
      )`,
    jira_settings: `
      CREATE TABLE IF NOT EXISTS jira_settings (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL,
        connection_id VARCHAR(36),
        instance_url VARCHAR(500) NOT NULL,
        project_key VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        api_token_encrypted TEXT NOT NULL,
        story_points_field_id VARCHAR(100),
        epic_link_field_id VARCHAR(100),
        sprint_field_id VARCHAR(100),
        acceptance_criteria_field_id VARCHAR(100),
        confluence_space_key VARCHAR(100),
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        last_tested_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uq_jira_settings_project (project_id)
      )`,
    user_jira_credentials: `
      CREATE TABLE IF NOT EXISTS user_jira_credentials (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        instance_url VARCHAR(500) NOT NULL,
        email VARCHAR(255) NOT NULL,
        api_token_encrypted TEXT NOT NULL,
        account_id VARCHAR(100),
        display_name VARCHAR(255),
        last_tested_at TIMESTAMP NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )`,
    user_git_credentials: `
      CREATE TABLE IF NOT EXISTS user_git_credentials (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        provider VARCHAR(20) NOT NULL,
        base_url VARCHAR(500) NOT NULL,
        token_encrypted TEXT NOT NULL,
        external_user_id VARCHAR(100) NULL,
        username VARCHAR(255) NULL,
        last_tested_at TIMESTAMP NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uniq_user_git (user_id, provider, base_url)
      )`,
    user_project_repo_credentials: `
      CREATE TABLE IF NOT EXISTS user_project_repo_credentials (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        project_id VARCHAR(36) NOT NULL,
        provider VARCHAR(20) NOT NULL,
        base_url VARCHAR(500) NOT NULL,
        token_encrypted TEXT NOT NULL,
        external_user_id VARCHAR(100) NULL,
        username VARCHAR(255) NULL,
        last_tested_at TIMESTAMP NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uniq_user_project_repo (user_id, project_id, provider, base_url)
      )`,
    user_project_integration_credentials: `
      CREATE TABLE IF NOT EXISTS user_project_integration_credentials (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        project_id VARCHAR(36) NOT NULL,
        integration_kind VARCHAR(50) NOT NULL,
        integration_id VARCHAR(100) NOT NULL,
        provider_key VARCHAR(100) NULL,
        last_test_status VARCHAR(20) DEFAULT 'untested',
        last_test_message TEXT NULL,
        last_tested_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY ux_user_project_integration_credentials (
          user_id,
          project_id,
          integration_kind,
          integration_id
        )
      )`,
    organization_members: `
      CREATE TABLE IF NOT EXISTS organization_members (
        id VARCHAR(36) PRIMARY KEY,
        organization_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'member',
        invited_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uniq_org_member (organization_id, user_id)
      )`,
    project_members: `
      CREATE TABLE IF NOT EXISTS project_members (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'member',
        invited_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uniq_project_member (project_id, user_id)
      )`,
  };

  for (const [table, ddl] of Object.entries(tableDDLs)) {
    try {
      const [rows]: any = await pool.query(
        `SELECT COUNT(*) as cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
      );
      if (rows[0].cnt === 0) {
        await pool.query(ddl);
        console.log(`✓ Created missing table: ${table}`);
      }
    } catch (e: any) {
      console.warn(`[db] ensureCrossPlatformSchema (${table}):`, e?.message || e);
    }
  }

  const columnChecks = [
    { table: "sdlc_projects", column: "is_generating", ddl: "ALTER TABLE sdlc_projects ADD COLUMN is_generating TINYINT(1) DEFAULT 0" },
    { table: "sdlc_projects", column: "integration_type", ddl: "ALTER TABLE sdlc_projects ADD COLUMN integration_type VARCHAR(50) DEFAULT 'ado'" },
    { table: "sdlc_projects", column: "jira_connection_id", ddl: "ALTER TABLE sdlc_projects ADD COLUMN jira_connection_id VARCHAR(36) NULL" },
    { table: "sdlc_projects", column: "jira_instance_url", ddl: "ALTER TABLE sdlc_projects ADD COLUMN jira_instance_url TEXT NULL" },
    { table: "sdlc_projects", column: "jira_project_key", ddl: "ALTER TABLE sdlc_projects ADD COLUMN jira_project_key VARCHAR(100) NULL" },
    { table: "sdlc_projects", column: "owner_user_id", ddl: "ALTER TABLE sdlc_projects ADD COLUMN owner_user_id VARCHAR(36) NULL" },
    { table: "sdlc_projects", column: "deleted_from_ado", ddl: "ALTER TABLE sdlc_projects ADD COLUMN deleted_from_ado TINYINT(1) DEFAULT 0" },
    { table: "sdlc_projects", column: "enable_tdd", ddl: "ALTER TABLE sdlc_projects ADD COLUMN enable_tdd TINYINT(1) DEFAULT 0" },
    { table: "sdlc_projects", column: "golden_repo_reference", ddl: "ALTER TABLE sdlc_projects ADD COLUMN golden_repo_reference JSON NULL" },
    { table: "sdlc_projects", column: "status", ddl: "ALTER TABLE sdlc_projects ADD COLUMN status TEXT DEFAULT 'active'" },
    { table: "sdlc_projects", column: "ado_project_url", ddl: "ALTER TABLE sdlc_projects ADD COLUMN ado_project_url TEXT NULL" },
    { table: "sdlc_projects", column: "linked_golden_repo_org", ddl: "ALTER TABLE sdlc_projects ADD COLUMN linked_golden_repo_org TEXT NULL" },
    { table: "sdlc_projects", column: "linked_golden_repo_project", ddl: "ALTER TABLE sdlc_projects ADD COLUMN linked_golden_repo_project TEXT NULL" },
    { table: "sdlc_projects", column: "linked_golden_repo_name", ddl: "ALTER TABLE sdlc_projects ADD COLUMN linked_golden_repo_name TEXT NULL" },
    { table: "jira_connections", column: "is_admin_connection", ddl: "ALTER TABLE jira_connections ADD COLUMN is_admin_connection TINYINT NOT NULL DEFAULT 0" },
    { table: "jira_settings", column: "project_id", ddl: "ALTER TABLE jira_settings ADD COLUMN project_id VARCHAR(36) NOT NULL DEFAULT ''" },
    { table: "jira_settings", column: "connection_id", ddl: "ALTER TABLE jira_settings ADD COLUMN connection_id VARCHAR(36) NULL" },
    { table: "jira_settings", column: "instance_url", ddl: "ALTER TABLE jira_settings ADD COLUMN instance_url VARCHAR(500) NOT NULL DEFAULT ''" },
    { table: "jira_settings", column: "project_key", ddl: "ALTER TABLE jira_settings ADD COLUMN project_key VARCHAR(100) NOT NULL DEFAULT ''" },
    { table: "jira_settings", column: "email", ddl: "ALTER TABLE jira_settings ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT ''" },
    { table: "jira_settings", column: "api_token_encrypted", ddl: "ALTER TABLE jira_settings ADD COLUMN api_token_encrypted TEXT NULL" },
    { table: "jira_settings", column: "story_points_field_id", ddl: "ALTER TABLE jira_settings ADD COLUMN story_points_field_id VARCHAR(100) NULL" },
    { table: "jira_settings", column: "epic_link_field_id", ddl: "ALTER TABLE jira_settings ADD COLUMN epic_link_field_id VARCHAR(100) NULL" },
    { table: "jira_settings", column: "sprint_field_id", ddl: "ALTER TABLE jira_settings ADD COLUMN sprint_field_id VARCHAR(100) NULL" },
    { table: "jira_settings", column: "acceptance_criteria_field_id", ddl: "ALTER TABLE jira_settings ADD COLUMN acceptance_criteria_field_id VARCHAR(100) NULL" },
    { table: "jira_settings", column: "is_active", ddl: "ALTER TABLE jira_settings ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1" },
    { table: "jira_settings", column: "last_tested_at", ddl: "ALTER TABLE jira_settings ADD COLUMN last_tested_at TIMESTAMP NULL" },
    { table: "jira_settings", column: "confluence_space_key", ddl: "ALTER TABLE jira_settings ADD COLUMN confluence_space_key VARCHAR(100) NULL" },
    { table: "integration_settings", column: "project_id", ddl: "ALTER TABLE integration_settings ADD COLUMN project_id VARCHAR(36) NOT NULL DEFAULT ''" },
    { table: "integration_settings", column: "integration_type", ddl: "ALTER TABLE integration_settings ADD COLUMN integration_type VARCHAR(50) NOT NULL DEFAULT 'ado'" },
    { table: "users", column: "mfa_secret", ddl: "ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(255) NULL" },
    { table: "users", column: "is_mfa_enabled", ddl: "ALTER TABLE users ADD COLUMN is_mfa_enabled TINYINT(1) DEFAULT 0" },
    { table: "users", column: "provider", ddl: "ALTER TABLE users ADD COLUMN provider VARCHAR(50) NULL" },
    { table: "users", column: "provider_user_id", ddl: "ALTER TABLE users ADD COLUMN provider_user_id VARCHAR(255) NULL" },
    { table: "users", column: "onboarding_completed", ddl: "ALTER TABLE users ADD COLUMN onboarding_completed TINYINT(1) NOT NULL DEFAULT 0" },
    { table: "users", column: "onboarding_completed_at", ddl: "ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMP NULL" },
    { table: "organizations", column: "owner_user_id", ddl: "ALTER TABLE organizations ADD COLUMN owner_user_id VARCHAR(36) NULL" },
    { table: "projects", column: "owner_user_id", ddl: "ALTER TABLE projects ADD COLUMN owner_user_id VARCHAR(36) NULL" },
    { table: "sdlc_specs_files", column: "input_hash", ddl: "ALTER TABLE sdlc_specs_files ADD COLUMN input_hash VARCHAR(64) NULL" },
    { table: "sdlc_specs_files", column: "spec_version", ddl: "ALTER TABLE sdlc_specs_files ADD COLUMN spec_version INT DEFAULT 1" },
    { table: "project_git_config", column: "token", ddl: "ALTER TABLE project_git_config ADD COLUMN token TEXT NULL" },
  ];

  for (const { table, column, ddl } of columnChecks) {
    try {
      const [rows]: any = await pool.query(
        `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      if (rows[0].cnt === 0) {
        await pool.query(ddl);
        console.log(`✓ Added missing column: ${table}.${column}`);
      }
    } catch (e: any) {
      if (e?.errno !== 1060) {
        console.warn(`[db] ensureCrossPlatformSchema (${table}.${column}):`, e?.message || e);
      }
    }
  }

  // Older generated baselines accidentally added UNIQUE KEY tenant_id to
  // organizations, which made a tenant capable of owning only one organization.
  // The product model is tenant -> many organizations, so remove any single
  // column unique index on organizations.tenant_id.
  try {
    const [indexRows]: any = await pool.query(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'organizations'
         AND COLUMN_NAME = 'tenant_id'
         AND NON_UNIQUE = 0
       GROUP BY INDEX_NAME
       HAVING COUNT(*) = 1`
    );

    for (const row of indexRows) {
      const indexName = String(row.INDEX_NAME || "");
      if (!indexName || indexName === "PRIMARY") continue;
      await pool.query(`ALTER TABLE organizations DROP INDEX \`${indexName.replace(/`/g, "``")}\``);
      console.log(`✓ Dropped invalid organizations.${indexName} unique index`);
    }
  } catch (e: any) {
    console.warn("[db] ensureCrossPlatformSchema (organizations tenant index):", e?.message || e);
  }

  // Fix license_keys table — may exist with wrong schema (missing 'id' column)
  try {
    const [lkRows]: any = await pool.query(
      `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'license_keys' AND COLUMN_NAME = 'id'`
    );
    if (lkRows[0].cnt === 0) {
      // Table either doesn't exist or exists without 'id'. Drop and recreate.
      await pool.query(`DROP TABLE IF EXISTS license_keys`);
      await pool.query(`
        CREATE TABLE license_keys (
          id VARCHAR(36) PRIMARY KEY,
          tenant_id VARCHAR(36) NOT NULL,
          license_hash VARCHAR(255) NOT NULL,
          salt VARCHAR(255) NOT NULL,
          integrity_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log("✓ Recreated license_keys table with correct schema");
    }
  } catch (e: any) {
    console.warn("[db] ensureCrossPlatformSchema (license_keys):", e?.message || e);
  }

  // Ensure subscription_types has correct schema (needs 'id' auto-increment column)
  try {
    const [stRows]: any = await pool.query(
      `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_types' AND COLUMN_NAME = 'id'`
    );
    if (stRows[0].cnt === 0) {
      await pool.query(`DROP TABLE IF EXISTS subscription_types`);
      await pool.query(`
        CREATE TABLE subscription_types (
          id INT AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(50) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log("✓ Recreated subscription_types table with correct schema");
    }
  } catch (e: any) {
    console.warn("[db] ensureCrossPlatformSchema (subscription_types):", e?.message || e);
  }
}

/**
 * Call once after env (and optional Secrets Manager) is ready.
 */
/** Ensure users table has soft-delete columns (is_deleted, deleted_at). */
async function ensureUsersSoftDeleteColumns(): Promise<void> {
  try {
    const pool = getPool();
    const [isDeletedRows]: any = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name = 'is_deleted'
      AND table_schema = DATABASE()
    `);
    if (isDeletedRows[0].count === 0) {
      console.log("[db] Adding is_deleted column to users table...");
      await pool.query(
        "ALTER TABLE users ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Soft-delete flag: 1 = deleted, 0 = active'"
      );
      console.log("[db] ✓ is_deleted column added successfully");
    }

    const [deletedAtRows]: any = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name = 'deleted_at'
      AND table_schema = DATABASE()
    `);
    if (deletedAtRows[0].count === 0) {
      console.log("[db] Adding deleted_at column to users table...");
      await pool.query(
        "ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL COMMENT 'Timestamp when the user was soft-deleted'"
      );
      console.log("[db] ✓ deleted_at column added successfully");
    }

    try {
      await pool.query(
        "ALTER TABLE audit_logs MODIFY COLUMN action ENUM('ROLE_ASSIGNED', 'ROLE_REMOVED', 'USER_SOFT_DELETED') NOT NULL"
      );
    } catch (e: any) {
      if (e?.errno !== 1265) {
        console.warn("[db] ensureUsersSoftDeleteColumns (audit_logs enum):", e?.message || e);
      }
    }
  } catch (e: any) {
    if (e?.errno !== 1060) {
      console.warn("[db] ensureUsersSoftDeleteColumns:", e?.message || e);
    }
  }
}

/**
 * Seed the default Skill templates the first time the `prompts` table is empty.
 * Lazy-imports `./storage` to avoid the circular import between db.ts and storage.ts.
 */
async function seedDefaultPromptsIfEmpty(): Promise<void> {
  try {
    const { storage } = await import("./storage");
    await storage.initializeDefaultPrompts();
  } catch (e: any) {
    console.warn("[db] seedDefaultPromptsIfEmpty:", e?.message || e);
  }
}

async function ensurePromptsTable(): Promise<void> {
  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS prompts (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        content LONGTEXT NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'General',
        tags JSON,
        usage_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )
    `);
    console.log("✓ prompts table ready");
  } catch (e: any) {
    console.warn("[db] ensurePromptsTable:", e?.message || e);
  }
}

export async function initializeDatabase(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const config = getConfig();
  try {
    const connection = await getPool().getConnection();
    console.log("✓ Successfully connected to MySQL database");
    console.log(`   Host: ${config.host}`);
    console.log(`   Database: ${config.database}`);
    connection.release();

    await verifyCriticalTables();
    await ensureCrossPlatformSchema();

    await Promise.all([
      ensureProjectGitConfigTable(),
      ensureTokenUsageLogsTable(),
      ensureArtifactEventsTable(),
      ensureTestingTablesExist(),
      ensureUsersSoftDeleteColumns(),
      ensurePromptsTable(),
      ensurePolarisMetricsTables(),
    ]);
    console.log("✓ project_git_config and token_usage_logs tables ready");

    await seedDefaultRoles();
    await seedDefaultSubscriptionTypes();
    await fixAndCreateSubscriptions();
    await seedDefaultPromptsIfEmpty();

    try {
      const { ensureTablesExist } = await import("./stack-modernization/services/db-persistence");
      await ensureTablesExist();
    } catch {
      /* optional */
    }
  } catch (error) {
    console.error("✗ Failed to connect to MySQL database:", error);
    console.error(`   Host: ${config.host}`);
    console.error(`   Database: ${config.database}`);
  }
}

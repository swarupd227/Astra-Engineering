// Check if database schema is in sync with code schema definitions
import mysql from "mysql2/promise";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { loadRuntimeEnv } from "./load-runtime-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await loadRuntimeEnv({ path: join(__dirname, "..", ".env") });

const REQUIRED_MYSQL_ENV_KEYS = [
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];

function assertMysqlEnv() {
  const missing = REQUIRED_MYSQL_ENV_KEYS.filter((key) => {
    const value = process.env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length === 0) return;

  console.error("\n❌ Schema sync check cannot connect to MySQL.");
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  if (String(process.env.DEVX_HOSTING || "").toLowerCase() === "aws" && process.env.DEVX_USE_LOCAL_DB !== "true") {
    console.error("\nDEVX_HOSTING=aws and DEVX_USE_LOCAL_DB=false, so MySQL settings should come from AWS Secrets Manager.");
    console.error(`Secret: ${process.env.AWS_SECRET_NAME || "devx/platform/qa"}`);
    console.error(`Region: ${process.env.AWS_REGION || "ap-south-1"}`);
    console.error("Check AWS credentials/IAM access and confirm the secret contains the missing keys.");
  } else {
    console.error("\nSet these in your shell or .env before committing schema changes:");
    console.error("  MYSQL_HOST=<host>");
    console.error("  MYSQL_PORT=3306");
    console.error("  MYSQL_USER=<user>");
    console.error("  MYSQL_PASSWORD=<password>");
    console.error("  MYSQL_DATABASE=<database>");
  }
  console.error("\nThen rerun: npm run check:schema\n");
  process.exit(1);
}

// Define expected schema for all SDLC tables
// These schemas are based on Drizzle ORM definitions in shared/schema.ts
const EXPECTED_SCHEMAS = {
  'sdlc_backlog_items': [
    { name: 'id', type: 'varchar', length: 36, nullable: false, key: 'PRI' },
    { name: 'project_id', type: 'varchar', length: 36, nullable: false },
    { name: 'phase_number', type: 'int', nullable: false },
    { name: 'title', type: 'text', nullable: false },
    { name: 'description', type: 'text', nullable: true },
    { name: 'type', type: 'text', nullable: false },
    { name: 'story_points', type: 'int', nullable: true },
    { name: 'priority', type: 'text', nullable: false },
    { name: 'status', type: 'text', nullable: false },
    { name: 'assigned_to', type: 'text', nullable: true },
    { name: 'feature_id', type: 'varchar', length: 36, nullable: true },
    { name: 'epic_id', type: 'varchar', length: 36, nullable: true },
    { name: 'figma_link', type: 'text', nullable: true },
    { name: 'persona', type: 'text', nullable: true },
    { name: 'persona_id', type: 'varchar', length: 36, nullable: true },
    { name: 'acceptance_criteria', type: 'json', nullable: true },
    { name: 'subtasks', type: 'json', nullable: true },
    { name: 'source', type: 'varchar', length: 50, nullable: true },
    { name: 'workflow_session_id', type: 'varchar', length: 36, nullable: true },
    { name: 'created_at', type: 'timestamp', nullable: false },
    { name: 'updated_at', type: 'timestamp', nullable: false },
    { name: 'brd_id',  type: 'varchar', length: 36, nullable: true  },
    { name: 'requirement_id', type: 'varchar', length: 36, nullable: true },
    { name: 'jira_issue_id', type: 'varchar', length: 100, nullable: true },
    { name: 'jira_pushed_at', type: 'timestamp', nullable: true },
    { name: 'jira_synced_at', type: 'timestamp', nullable: true },
  ],
  'sdlc_projects': [
    { name: 'id', type: 'varchar', length: 36, nullable: false, key: 'PRI' },
    { name: 'name', type: 'varchar', length: 255, nullable: false },
    { name: 'description', type: 'text', nullable: true },
    { name: 'organization', type: 'varchar', length: 255, nullable: true },
    { name: 'repository_id', type: 'varchar', length: 255, nullable: true },
    { name: 'repository_count', type: 'int', nullable: true },
    { name: 'cloud_provider', type: 'varchar', length: 100, nullable: true },
    { name: 'status', type: 'varchar', length: 50, nullable: false },
    { name: 'created_at', type: 'timestamp', nullable: false },
    { name: 'updated_at', type: 'timestamp', nullable: false },
    // Extra columns that are now part of the expected schema
    { name: 'deleted_from_ado', type: 'tinyint', nullable: true },
    { name: 'project_id', type: 'varchar', length: 255, nullable: true },
    { name: 'ado_project_url', type: 'text', nullable: true },
    { name: 'integration_type', type: 'varchar', length: 50, nullable: false },
    { name: 'jira_connection_id', type: 'varchar', length: 36, nullable: true },
    { name: 'jira_instance_url', type: 'text', nullable: true },
    { name: 'jira_project_key', type: 'varchar', length: 100, nullable: true },
    { name: 'linked_golden_repo_org', type: 'text', nullable: true },
    { name: 'linked_golden_repo_project', type: 'text', nullable: true },
    { name: 'linked_golden_repo_name', type: 'text', nullable: true },
    { name: 'golden_repo_reference', type: 'json', nullable: true },
    { name: 'enable_tdd', type: 'tinyint', nullable: true },
    { name: 'specs_architecture_style', type: 'varchar', length: 50, nullable: true },
    { name: 'specs_delivery_order', type: 'text', nullable: true },
    { name: 'work_items_available', type: 'json', nullable: true },
    { name: 'application_type', type: 'varchar', length: 50, nullable: true },
    { name: 'owner_user_id', type: 'varchar', length: 36, nullable: true },
    { name: 'is_generating', type: 'tinyint', nullable: false },
  ],
  sdlc_phases: [
    { name: "id", type: "varchar", length: 36, nullable: false, key: "PRI" },
    { name: "project_id", type: "varchar", length: 36, nullable: false },
    { name: "phase_number", type: "int", nullable: false },
    { name: "phase_name", type: "varchar", length: 100, nullable: false },
    { name: "status", type: "varchar", length: 50, nullable: false },
    { name: "progress", type: "int", nullable: true },
    { name: "notes", type: "text", nullable: true },
    { name: "assigned_to", type: "varchar", length: 255, nullable: true },
    { name: "deliverables", type: "text", nullable: true },
    { name: "start_date", type: "timestamp", nullable: true },
    { name: "end_date", type: "timestamp", nullable: true },
    { name: "completed_date", type: "timestamp", nullable: true },
    { name: "created_at", type: "timestamp", nullable: false },
    { name: "updated_at", type: "timestamp", nullable: false },
  ],
};

class SchemaValidator {
  constructor(connection) {
    this.connection = connection;
  }

  async getActualSchema(tableName) {
    const [columns] = await this.connection.execute(
      `SELECT 
        COLUMN_NAME as name,
        COLUMN_TYPE as type,
        IS_NULLABLE as nullable,
        COLUMN_KEY as \`key\`,
        CHARACTER_MAXIMUM_LENGTH as length
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [process.env.MYSQL_DATABASE, tableName],
    );
    return columns;
  }

  async tableExists(tableName) {
    const [tables] = await this.connection.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [process.env.MYSQL_DATABASE, tableName],
    );
    return tables.length > 0;
  }

  detectDifferences(tableName, expected, actual) {
    const actualMap = new Map(actual.map((col) => [col.name, col]));
    const expectedMap = new Map(expected.map((col) => [col.name, col]));

    const differences = {
      missing: [],
      extra: [],
      typeMismatch: [],
    };

    // Check for missing columns
    for (const [name, col] of expectedMap) {
      if (!actualMap.has(name)) {
        differences.missing.push(col);
      }
    }

    // Check for extra columns
    for (const [name, col] of actualMap) {
      if (!expectedMap.has(name)) {
        differences.extra.push(col);
      }
    }

    return differences;
  }

  generateMigrationSQL(tableName, differences) {
    const timestamp = Date.now();
    let sql = `-- Auto-generated migration for ${tableName}\n`;
    sql += `-- Generated at: ${new Date().toISOString()}\n`;
    sql += `-- Author: Schema Sync Tool\n\n`;

    if (differences.missing.length > 0) {
      sql += `-- ============================================\n`;
      sql += `-- Missing columns in database\n`;
      sql += `-- ============================================\n\n`;

      for (const col of differences.missing) {
        const typeStr = this.getColumnTypeString(col);
        const nullable = col.nullable ? "" : " NOT NULL";
        sql += `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${col.name} ${typeStr}${nullable};\n`;
      }
      sql += "\n";
    }

    if (differences.extra.length > 0) {
      sql += `-- ============================================\n`;
      sql += `-- Extra columns in database (review carefully!)\n`;
      sql += `-- ============================================\n\n`;

      for (const col of differences.extra) {
        sql += `-- ⚠️  WARNING: Review before uncommenting!\n`;
        sql += `-- ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${col.name};\n\n`;
      }
    }

    // Add verification queries
    sql += `-- ============================================\n`;
    sql += `-- Verification queries\n`;
    sql += `-- ============================================\n\n`;
    sql += `-- Verify table structure\n`;
    sql += `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY\n`;
    sql += `FROM INFORMATION_SCHEMA.COLUMNS\n`;
    sql += `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'\n`;
    sql += `ORDER BY ORDINAL_POSITION;\n`;

    return { sql, filename: `${timestamp}-sync-${tableName}.sql` };
  }

  getColumnTypeString(col) {
    if (col.length) {
      return `${col.type}(${col.length})`;
    }
    return col.type;
  }
}

async function checkSchemaSync() {
  assertMysqlEnv();

  console.log("\n" + "=".repeat(80));
  console.log("🔍 DATABASE SCHEMA SYNC CHECK");
  console.log("=".repeat(80));
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log(`🗄️  Database: ${process.env.MYSQL_DATABASE}`);
  console.log(`🏠 Host: ${process.env.MYSQL_HOST}\n`);

  let connection;
  let hasDifferences = false;
  const generatedMigrations = [];

  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: { rejectUnauthorized: false },
    });

    console.log("✅ Connected to database\n");

    const validator = new SchemaValidator(connection);

    // Check each table
    for (const [tableName, expectedSchema] of Object.entries(
      EXPECTED_SCHEMAS,
    )) {
      console.log(`\n${"─".repeat(80)}`);
      console.log(`📋 Checking: ${tableName}`);
      console.log("─".repeat(80));

      // Check if table exists
      const exists = await validator.tableExists(tableName);
      if (!exists) {
        console.error(`❌ Table '${tableName}' does not exist in database!`);
        console.error(`   This table needs to be created first.\n`);
        hasDifferences = true;
        continue;
      }

      const actualSchema = await validator.getActualSchema(tableName);
      const differences = validator.detectDifferences(
        tableName,
        expectedSchema,
        actualSchema,
      );

      if (differences.missing.length === 0 && differences.extra.length === 0) {
        console.log(`✅ Schema in sync (${actualSchema.length} columns)`);
      } else {
        hasDifferences = true;
        console.error(`❌ Schema OUT OF SYNC!`);

        if (differences.missing.length > 0) {
          console.error(
            `\n  📌 Missing columns (${differences.missing.length}):`,
          );
          differences.missing.forEach((col) => {
            const typeStr = validator.getColumnTypeString(col);
            console.error(`     - ${col.name} (${typeStr})`);
          });
        }

        if (differences.extra.length > 0) {
          console.error(`\n  📌 Extra columns (${differences.extra.length}):`);
          differences.extra.forEach((col) => {
            console.error(`     - ${col.name} (${col.type})`);
          });
        }

        // Generate migration file
        const { sql, filename } = validator.generateMigrationSQL(
          tableName,
          differences,
        );

        // Ensure migrations directory exists
        const migrationsDir = join(
          __dirname,
          "..",
          "migrations",
          "auto-generated",
        );
        if (!existsSync(migrationsDir)) {
          mkdirSync(migrationsDir, { recursive: true });
        }

        const filepath = join(migrationsDir, filename);
        writeFileSync(filepath, sql);

        generatedMigrations.push(filename);
        console.log(
          `\n  📝 Generated migration: migrations/auto-generated/${filename}`,
        );
      }
    }

    console.log(`\n${"=".repeat(80)}`);

    if (hasDifferences) {
      console.error(`\n❌ SCHEMA SYNC CHECK FAILED!\n`);
      console.error(`⚠️  Action Required:`);
      console.error(
        `   1. Review the generated migration files in migrations/auto-generated/`,
      );
      console.error(`   2. Test migrations locally: npm run migrate:dev`);
      console.error(`   3. Commit migration files with your schema changes`);

      if (generatedMigrations.length > 0) {
        console.error(`\n📝 Generated migration files:`);
        generatedMigrations.forEach((file) => {
          console.error(`   - migrations/auto-generated/${file}`);
        });
      }

      console.error(`\n${"=".repeat(80)}\n`);
      process.exit(1);
    } else {
      console.log(`\n✅ ALL SCHEMAS IN SYNC!\n`);
      console.log(
        `All ${Object.keys(EXPECTED_SCHEMAS).length} tables match their schema definitions.`,
      );
      console.log(`${"=".repeat(80)}\n`);
    }
  } catch (error) {
    console.error("\n❌ Error during schema sync check:");
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the check
checkSchemaSync().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

#!/usr/bin/env node

import fs from "node:fs";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ override: true });

const requiredEnv = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`[db:doctor] Missing required env var(s): ${missingEnv.join(", ")}`);
  process.exit(1);
}

const mysqlHost = process.env.MYSQL_HOST;
const mysqlPort = Number.parseInt(process.env.MYSQL_PORT || "3306", 10);
const isLocalMySql =
  mysqlHost === "localhost" ||
  mysqlHost === "127.0.0.1" ||
  mysqlHost === "::1";

if (!isLocalMySql && !process.env.MYSQL_PASSWORD) {
  console.error("[db:doctor] Missing required env var(s): MYSQL_PASSWORD");
  process.exit(1);
}

const expectedColumns = [
  ["users", "mfa_secret", ["varchar"]],
  ["users", "is_mfa_enabled", ["tinyint"]],
  ["users", "is_deleted", ["tinyint"]],
  ["users", "deleted_at", ["datetime", "timestamp"]],
  ["sdlc_projects", "is_generating", ["tinyint"]],
  ["dev_brd_documents", "approval_status", ["varchar"]],
  ["dev_brd_documents", "generation_status", ["varchar"]],
  ["dev_brd_documents", "deleted_at", ["timestamp", "datetime"]],
  ["brd_generation_metrics", "llm_provider", ["varchar"]],
  ["brd_generation_metrics", "llm_models_json", ["json"]],
  ["prompts", "id", ["varchar", "char"]],
  ["prompts", "title", ["varchar"]],
  ["prompts", "content", ["longtext", "text", "mediumtext"]],
  ["prompts", "category", ["varchar"]],
  ["prompts", "usage_count", ["int"]],
  ["prompts", "created_at", ["timestamp", "datetime"]],
  ["prompts", "updated_at", ["timestamp", "datetime"]],
];

const expectedIndexes = [
  ["dev_brd_documents", "idx_dev_brd_project_approval_deleted_updated"],
  ["brd_generation_jobs", "brd_generation_jobs_brd_id_idx"],
  ["brd_generation_jobs", "brd_generation_jobs_status_created_at_idx"],
];

const expectedCharset = "utf8mb4";
const expectedCollation = "utf8mb4_unicode_ci";
const strictCollationCheck =
  process.env.DB_DOCTOR_STRICT_COLLATION === "true" ||
  process.env.CI_STRICT_COLLATION === "true";

function readRequiredMigrationNames() {
  try {
    const raw = fs.readFileSync("migrations/migration-order.json", "utf8");
    const parsed = JSON.parse(raw);
    const migrationNames = [];
    for (const phase of parsed.phases || []) {
      for (const file of phase.files || []) {
        if (phase.optional && phase.env && process.env[phase.env] !== "true" && process.env[phase.env] !== "1") {
          continue;
        }
        migrationNames.push(String(file).replace(/\\/g, "/").replace(/\.sql$/i, ""));
      }
    }
    return migrationNames;
  } catch {
    return [];
  }
}

const failures = [];
const warnings = [];

const connection = await mysql.createConnection({
  host: mysqlHost,
  port: mysqlPort,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE,
  ssl: isLocalMySql ? undefined : { rejectUnauthorized: false },
});

try {
  console.log(
    `[db:doctor] Checking ${process.env.MYSQL_DATABASE} on ${mysqlHost}:${mysqlPort}`,
  );

  for (const [tableName, columnName, allowedTypes] of expectedColumns) {
    const [rows] = await connection.query(
      `
        SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1
      `,
      [tableName, columnName],
    );

    if (rows.length === 0) {
      failures.push(`Missing column ${tableName}.${columnName}`);
      continue;
    }

    const dataType = String(rows[0].dataType || "").toLowerCase();
    if (!allowedTypes.includes(dataType)) {
      failures.push(
        `Wrong type for ${tableName}.${columnName}: expected ${allowedTypes.join(" or ")}, got ${dataType}`,
      );
    }
  }

  for (const [tableName, indexName] of expectedIndexes) {
    const [rows] = await connection.query(
      `
        SELECT INDEX_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
        LIMIT 1
      `,
      [tableName, indexName],
    );

    if (rows.length === 0) {
      failures.push(`Missing index ${tableName}.${indexName}`);
    }
  }

  const [subscriptionTypeIdRows] = await connection.query(`
    SELECT DATA_TYPE AS dataType
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'subscription_types'
      AND COLUMN_NAME = 'id'
    LIMIT 1
  `);
  const subscriptionTypeIdType = String(
    subscriptionTypeIdRows[0]?.dataType || "",
  ).toLowerCase();
  if (["char", "varchar"].includes(subscriptionTypeIdType)) {
    warnings.push(
      "subscription_types.id is UUID-style char/varchar; app bootstrap tolerates this legacy shape",
    );
  } else if (subscriptionTypeIdType !== "int") {
    failures.push(
      `Wrong type for subscription_types.id: expected int or legacy char/varchar, got ${subscriptionTypeIdType || "missing"}`,
    );
  }

  const requiredMigrationNames = readRequiredMigrationNames();
  if (requiredMigrationNames.length > 0) {
    const [schemaMigrationTables] = await connection.query(`
      SELECT TABLE_NAME AS tableName
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'schema_migrations'
      LIMIT 1
    `);

    if (schemaMigrationTables.length === 0) {
      failures.push("Missing schema_migrations table");
    } else {
      const [migrationRows] = await connection.query(
        `
          SELECT migration_name AS migrationName
          FROM schema_migrations
          WHERE status = 'success'
        `,
      );
      const appliedMigrationNames = new Set(
        migrationRows.map((row) => String(row.migrationName || "")),
      );
      const missingMigrationNames = requiredMigrationNames.filter(
        (migrationName) => !appliedMigrationNames.has(migrationName),
      );

      if (missingMigrationNames.length > 0) {
        const examples = missingMigrationNames.slice(0, 10).join(", ");
        const suffix =
          missingMigrationNames.length > 10
            ? `; plus ${missingMigrationNames.length - 10} more`
            : "";
        failures.push(`Manifest migrations not fully applied: ${examples}${suffix}`);
      }
    }
  }

  const [databaseDefaults] = await connection.query(`
    SELECT DEFAULT_CHARACTER_SET_NAME AS charsetName,
           DEFAULT_COLLATION_NAME AS collationName
    FROM information_schema.SCHEMATA
    WHERE SCHEMA_NAME = DATABASE()
    LIMIT 1
  `);
  const currentCharset = databaseDefaults[0]?.charsetName;
  const currentCollation = databaseDefaults[0]?.collationName;
  if (currentCharset !== expectedCharset || currentCollation !== expectedCollation) {
    const message =
      `Database default charset/collation is ${currentCharset}/${currentCollation}; ` +
      `expected ${expectedCharset}/${expectedCollation}`;
    if (strictCollationCheck) failures.push(message);
    else warnings.push(message);
  }

  const [mixedTables] = await connection.query(`
    SELECT TABLE_NAME AS tableName,
           COUNT(DISTINCT COLLATION_NAME) AS collationCount,
           GROUP_CONCAT(DISTINCT COLLATION_NAME ORDER BY COLLATION_NAME SEPARATOR ', ') AS collations
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND COLLATION_NAME IS NOT NULL
    GROUP BY TABLE_NAME
    HAVING COUNT(DISTINCT COLLATION_NAME) > 1
    ORDER BY TABLE_NAME
  `);
  for (const row of mixedTables) {
    const message = `Mixed collations in table ${row.tableName}: ${row.collations}`;
    if (strictCollationCheck) failures.push(message);
    else warnings.push(message);
  }

  const [relationshipCollationRows] = await connection.query(
    `
      SELECT TABLE_NAME AS tableName,
             COLUMN_NAME AS columnName,
             COLUMN_TYPE AS columnType,
             CHARACTER_SET_NAME AS charsetName,
             COLLATION_NAME AS collationName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLLATION_NAME IS NOT NULL
        AND (
          COLUMN_NAME = 'id'
          OR COLUMN_NAME LIKE '%\\_id'
          OR COLUMN_NAME IN ('created_by', 'updated_by', 'deleted_by', 'deleted_by_user_id')
        )
        AND (CHARACTER_SET_NAME <> ? OR COLLATION_NAME <> ?)
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `,
    [expectedCharset, expectedCollation],
  );

  if (relationshipCollationRows.length > 0) {
    const examples = relationshipCollationRows
      .slice(0, 20)
      .map(
        (row) =>
          `${row.tableName}.${row.columnName} ${row.columnType} ` +
          `${row.charsetName}/${row.collationName}`,
      );
    const suffix =
      relationshipCollationRows.length > examples.length
        ? `; plus ${relationshipCollationRows.length - examples.length} more`
        : "";
    const message =
      `Relationship columns must use ${expectedCharset}/${expectedCollation}: ` +
      `${examples.join("; ")}${suffix}`;
    if (strictCollationCheck) failures.push(message);
    else warnings.push(message);
  }
} finally {
  await connection.end();
}

for (const warning of warnings) {
  console.warn(`[db:doctor] WARN ${warning}`);
}

if (failures.length > 0) {
  console.error("[db:doctor] FAILED");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("[db:doctor] OK live database satisfies required app schema checks");

import "dotenv/config";
import mysql from "mysql2/promise";

type ColumnInfo = {
  tableName: string;
  columnName: string;
  columnType: string;
  isNullable: "YES" | "NO";
  collationName: string | null;
};

type Edge = {
  table: string;
  column: string;
  referenceTable: string;
  referenceColumn: string;
  reason: string;
};

const APPLY = process.argv.includes("--apply");

const edges: Edge[] = [
  {
    table: "project_members",
    column: "project_id",
    referenceTable: "sdlc_projects",
    referenceColumn: "id",
    reason: "Project membership rows reference SDLC projects.",
  },
  {
    table: "jira_settings",
    column: "project_id",
    referenceTable: "sdlc_projects",
    referenceColumn: "id",
    reason: "Jira settings are keyed by SDLC project id.",
  },
  {
    table: "sdlc_projects",
    column: "owner_user_id",
    referenceTable: "users",
    referenceColumn: "id",
    reason: "Project ownership references users.",
  },
  {
    table: "sdlc_projects",
    column: "jira_connection_id",
    referenceTable: "jira_connections",
    referenceColumn: "id",
    reason: "Jira projects reference Jira organization connections.",
  },
];

async function loadRuntimeSecrets() {
  if (process.env.DEVX_HOSTING === "aws") {
    const { loadSecrets } = await import("../server/secrets-loader");
    await loadSecrets();
  }
}

function assertDbConfig() {
  const missing = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"].filter(
    (key) => !process.env[key],
  );
  if (missing.length) {
    throw new Error(`Missing database configuration: ${missing.join(", ")}`);
  }
}

async function main() {
  await loadRuntimeSecrets();
  assertDbConfig();

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: "utf8mb4_0900_ai_ci",
    ssl: process.env.MYSQL_SSL === "false" ? undefined : { rejectUnauthorized: false },
  });

  const [dbRows] = await connection.query<Array<{ db: string; host: string; user: string }>>(
    "SELECT DATABASE() AS db, @@hostname AS host, CURRENT_USER() AS user",
  );

  const relevantTables = Array.from(
    new Set(edges.flatMap((edge) => [edge.table, edge.referenceTable])),
  );
  const relevantColumns = Array.from(
    new Set(edges.flatMap((edge) => [edge.column, edge.referenceColumn])),
  );
  const [columns] = await connection.query<ColumnInfo[]>(
    `
      SELECT
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        COLUMN_TYPE AS columnType,
        IS_NULLABLE AS isNullable,
        COLLATION_NAME AS collationName
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND TABLE_NAME IN (${relevantTables.map(() => "?").join(", ")})
        AND COLUMN_NAME IN (${relevantColumns.map(() => "?").join(", ")})
    `,
    [...relevantTables, ...relevantColumns],
  );

  const byKey = new Map(columns.map((col) => [`${col.tableName}.${col.columnName}`, col]));
  const planned = edges.flatMap((edge) => {
    const source = byKey.get(`${edge.table}.${edge.column}`);
    const reference = byKey.get(`${edge.referenceTable}.${edge.referenceColumn}`);
    if (!source || !reference || !reference.collationName) return [];
    if (source.collationName === reference.collationName) return [];

    const nullable = source.isNullable === "YES" ? "NULL" : "NOT NULL";
    const sql = [
      `ALTER TABLE \`${edge.table}\``,
      `MODIFY \`${edge.column}\` ${source.columnType}`,
      `CHARACTER SET utf8mb4 COLLATE ${reference.collationName}`,
      nullable,
    ].join(" ");

    return [
      {
        ...edge,
        currentCollation: source.collationName,
        targetCollation: reference.collationName,
        sql,
      },
    ];
  });

  for (const item of planned) {
    if (APPLY) {
      await connection.query(item.sql);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        db: dbRows[0],
        driftCount: planned.length,
        drift: planned.map(({ table, column, referenceTable, referenceColumn, currentCollation, targetCollation, reason }) => ({
          column: `${table}.${column}`,
          reference: `${referenceTable}.${referenceColumn}`,
          currentCollation,
          targetCollation,
          reason,
        })),
      },
      null,
      2,
    ),
  );

  await connection.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

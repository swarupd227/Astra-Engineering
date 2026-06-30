#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadRuntimeEnv } from "./load-runtime-env.js";

const dotenvOverride =
  process.env.DOTENV_CONFIG_OVERRIDE === undefined
    ? process.env.NODE_ENV !== "production"
    : process.env.DOTENV_CONFIG_OVERRIDE === "true";

await loadRuntimeEnv({
  override: dotenvOverride,
});

const requiredEnv = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
const migrationsDir = path.resolve(process.cwd(), "migrations");
const manifestPath = path.join(migrationsDir, "migration-order.json");
const privilegesOnly = process.argv.includes("--privileges-only");

const failures = [];
const supportsColor = process.stderr.isTTY && process.env.NO_COLOR === undefined;
const ansi = {
  bold: (value) => (supportsColor ? `\x1b[1m${value}\x1b[0m` : value),
  red: (value) => (supportsColor ? `\x1b[31m${value}\x1b[0m` : value),
  yellow: (value) => (supportsColor ? `\x1b[33m${value}\x1b[0m` : value),
  cyan: (value) => (supportsColor ? `\x1b[36m${value}\x1b[0m` : value),
  dim: (value) => (supportsColor ? `\x1b[2m${value}\x1b[0m` : value),
};
const requiredDatabasePrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
  "INDEX",
  "REFERENCES",
  "CREATE TEMPORARY TABLES",
  "CREATE ROUTINE",
  "ALTER ROUTINE",
  "EXECUTE",
];
let connectedDatabaseInfo = null;

if (missingEnv.length > 0) {
  failures.push(`Missing required env var(s): ${missingEnv.join(", ")}`);
}

const mysqlHost = process.env.MYSQL_HOST;
const isLocalMySql =
  mysqlHost === "localhost" || mysqlHost === "127.0.0.1" || mysqlHost === "::1";
if (mysqlHost && !isLocalMySql && !process.env.MYSQL_PASSWORD) {
  failures.push("Missing required env var(s): MYSQL_PASSWORD");
}

if (!privilegesOnly && !fs.existsSync(manifestPath)) {
  failures.push(`Missing migration manifest: ${manifestPath}`);
} else if (!privilegesOnly) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const phase of manifest.phases || []) {
    for (const file of phase.files || []) {
      const migrationPath = path.join(migrationsDir, String(file).replace(/\\/g, "/"));
      if (!fs.existsSync(migrationPath)) {
        failures.push(`Missing migration file from ${phase.name || "manifest"}: ${migrationPath}`);
      }
    }
  }
}

function quoteSqlIdentifier(value) {
  return `\`${String(value).replaceAll("`", "``")}\``;
}

function quoteSqlString(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function buildGrantScript() {
  const database = quoteSqlIdentifier(process.env.MYSQL_DATABASE || "<database>");
  const grantUser = quoteSqlString(process.env.MYSQL_USER || "<user>");
  const grantHost = quoteSqlString(isLocalMySql ? "localhost" : "%");
  const passwordSql = process.env.MYSQL_PASSWORD
    ? ` IDENTIFIED BY ${quoteSqlString(process.env.MYSQL_PASSWORD)}`
    : "";

  return [
    "-- Run with a MySQL admin account, then rerun: npm run db:bootstrap",
    `CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `CREATE USER IF NOT EXISTS ${grantUser}@${grantHost}${passwordSql};`,
    `GRANT ${requiredDatabasePrivileges.join(", ")} ON ${database}.* TO ${grantUser}@${grantHost};`,
    "FLUSH PRIVILEGES;",
  ].join("\n");
}

function printSuggestedGrantScript() {
  const scriptLines = buildGrantScript().split("\n");

  console.error("");
  console.error(ansi.yellow(ansi.bold("[db:preflight] MySQL admin action required")));
  console.error(
    ansi.dim(
      "Copy the highlighted SQL below and run it using a MySQL admin account, then rerun npm run db:bootstrap.",
    ),
  );
  console.error(
    ansi.dim(
      "The SQL uses MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, and MYSQL_HOST to choose the user@host target.",
    ),
  );
  console.error("");
  console.error(ansi.cyan("Suggested SQL:"));
  for (const line of scriptLines) {
    console.error(ansi.cyan("  ") + ansi.bold(line));
  }
}

function normalizeGrantPrivilege(privilege) {
  return privilege.trim().toUpperCase().replace(/\s+/g, " ");
}

function extractPrivilegesFromGrant(grant) {
  const normalizedGrant = grant.toUpperCase().replace(/\s+/g, " ");
  const match = normalizedGrant.match(/^GRANT (.+?) ON /);
  if (!match) return [];

  const privilegeList = match[1];
  if (privilegeList.includes("ALL PRIVILEGES")) {
    return ["ALL PRIVILEGES"];
  }

  return privilegeList
    .split(",")
    .map((part) => normalizeGrantPrivilege(part.split("(")[0]))
    .filter(Boolean);
}

function grantAppliesToCurrentDatabase(grant, databaseName) {
  const normalizedGrant = grant.toUpperCase().replace(/\s+/g, " ");
  const escapedDatabase = String(databaseName).replaceAll("`", "``").toUpperCase();

  return (
    normalizedGrant.includes(" ON *.* ") ||
    normalizedGrant.includes(` ON \`${escapedDatabase}\`.* `) ||
    normalizedGrant.includes(` ON ${escapedDatabase}.* `)
  );
}

function findMissingPrivileges(grants, databaseName) {
  const privileges = new Set();

  for (const grant of grants) {
    if (!grantAppliesToCurrentDatabase(grant, databaseName)) continue;

    for (const privilege of extractPrivilegesFromGrant(grant)) {
      privileges.add(privilege);
    }
  }

  if (privileges.has("ALL PRIVILEGES")) return [];

  return requiredDatabasePrivileges.filter(
    (privilege) => !privileges.has(normalizeGrantPrivilege(privilege)),
  );
}

async function checkDatabasePrivileges() {
  if (missingEnv.length > 0 || (!isLocalMySql && !process.env.MYSQL_PASSWORD)) {
    return;
  }

  const mysqlPort = Number.parseInt(process.env.MYSQL_PORT || "3306", 10);
  if (Number.isNaN(mysqlPort)) {
    failures.push("MYSQL_PORT must be a valid number");
    return;
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: mysqlHost,
      port: mysqlPort,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD ?? "",
      database: process.env.MYSQL_DATABASE,
      ssl: isLocalMySql ? undefined : { rejectUnauthorized: false },
      multipleStatements: false,
    });

    const [databaseRows] = await connection.query(
      "SELECT DATABASE() AS db, @@hostname AS host, @@port AS port, CURRENT_USER() AS user",
    );
    connectedDatabaseInfo = databaseRows[0] || null;

    const [grantRows] = await connection.query("SHOW GRANTS FOR CURRENT_USER()");
    const grants = grantRows.flatMap((row) => Object.values(row).map(String));
    const missingPrivileges = findMissingPrivileges(
      grants,
      process.env.MYSQL_DATABASE,
    );

    if (missingPrivileges.length > 0) {
      failures.push(
        `MySQL user ${process.env.MYSQL_USER} is missing required privilege(s) on ${process.env.MYSQL_DATABASE}: ${missingPrivileges.join(", ")}`,
      );
    }
  } catch (error) {
    failures.push(
      `Unable to verify MySQL privileges: ${error.code || error.name || "Error"}: ${error.message}`,
    );
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

await checkDatabasePrivileges();

if (failures.length > 0) {
  console.error(ansi.red(ansi.bold("[db:preflight] Failed")));
  for (const failure of failures) {
    console.error(ansi.red("- ") + failure);
  }
  if (process.env.MYSQL_DATABASE && process.env.MYSQL_USER) {
    printSuggestedGrantScript();
  }
  process.exit(1);
}

if (connectedDatabaseInfo) {
  console.log(
    `[db:preflight] Connected to ${connectedDatabaseInfo.db} on ` +
      `${connectedDatabaseInfo.host}:${connectedDatabaseInfo.port} as ` +
      connectedDatabaseInfo.user,
  );
}

console.log(privilegesOnly ? "[db:privileges] OK" : "[db:preflight] OK");

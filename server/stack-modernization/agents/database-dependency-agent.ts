/**
 * Database Dependency Agent
 * Detects database usage, ORM frameworks, migration files, and version constraints.
 */

import type { StackModernizationState, DatabaseDependencyResult } from "../types";

const DB_PATTERNS: Array<{
  type: DatabaseDependencyResult["databases"][0]["type"];
  signatures: RegExp[];
  packageNames: string[];
}> = [
  {
    type: "sql-server",
    signatures: [/SqlConnection/i, /System\.Data\.SqlClient/i, /Microsoft\.Data\.SqlClient/i, /mssql/i, /tedious/i],
    packageNames: ["mssql", "tedious", "microsoft.data.sqlclient", "system.data.sqlclient"],
  },
  {
    type: "postgresql",
    signatures: [/Npgsql/i, /pg\.Pool/i, /psycopg2/i, /postgres/i],
    packageNames: ["pg", "npgsql", "psycopg2", "asyncpg", "npgsql.entityframeworkcore.postgresql"],
  },
  {
    type: "mysql",
    signatures: [/MySqlConnection/i, /mysql2?\b/i, /pymysql/i],
    packageNames: ["mysql", "mysql2", "pymysql", "mysqlconnector", "pomelo.entityframeworkcore.mysql"],
  },
  {
    type: "mongodb",
    signatures: [/MongoClient/i, /mongoose/i, /pymongo/i],
    packageNames: ["mongodb", "mongoose", "pymongo", "mongodb.driver"],
  },
  {
    type: "sqlite",
    signatures: [/sqlite/i, /SqliteConnection/i],
    packageNames: ["sqlite3", "better-sqlite3", "microsoft.data.sqlite"],
  },
  {
    type: "redis",
    signatures: [/redis/i, /StackExchange\.Redis/i, /ioredis/i],
    packageNames: ["redis", "ioredis", "stackexchange.redis"],
  },
  {
    type: "cosmosdb",
    signatures: [/CosmosClient/i, /Microsoft\.Azure\.Cosmos/i],
    packageNames: ["@azure/cosmos", "microsoft.azure.cosmos"],
  },
];

const ORM_PACKAGES: Array<{ name: string; packageNames: string[] }> = [
  { name: "Entity Framework Core", packageNames: ["microsoft.entityframeworkcore"] },
  { name: "Entity Framework", packageNames: ["entityframework"] },
  { name: "Dapper", packageNames: ["dapper"] },
  { name: "Sequelize", packageNames: ["sequelize"] },
  { name: "Prisma", packageNames: ["prisma", "@prisma/client"] },
  { name: "TypeORM", packageNames: ["typeorm"] },
  { name: "Mongoose", packageNames: ["mongoose"] },
  { name: "SQLAlchemy", packageNames: ["sqlalchemy"] },
  { name: "Django ORM", packageNames: ["django"] },
  { name: "Hibernate", packageNames: ["hibernate-core", "org.hibernate"] },
  { name: "Drizzle", packageNames: ["drizzle-orm"] },
  { name: "Knex", packageNames: ["knex"] },
];

const MIGRATION_PATTERNS = [
  /migrations?\//i,
  /\.migration\./i,
  /db\/migrate/i,
  /alembic/i,
  /flyway/i,
  /liquibase/i,
  /knex.*migrate/i,
];

export async function executeDatabaseDependencyAgent(
  state: StackModernizationState
): Promise<DatabaseDependencyResult> {
  const files = state.extractedFiles || [];
  const databases: DatabaseDependencyResult["databases"] = [];
  const orms: DatabaseDependencyResult["orms"] = [];
  const migrationFiles: string[] = [];
  let connectionStrings = 0;
  const versionConstraints: string[] = [];
  const seenDbTypes = new Set<string>();
  const seenOrms = new Set<string>();

  // Collect all dependency names from manifests
  const allDependencies = new Set<string>();
  for (const m of state.repoProfile?.packageManifests || []) {
    if (m.parsed?.dependencies) {
      for (const name of Object.keys(m.parsed.dependencies)) allDependencies.add(name.toLowerCase());
    }
    if (m.parsed?.devDependencies) {
      for (const name of Object.keys(m.parsed.devDependencies)) allDependencies.add(name.toLowerCase());
    }
    if (Array.isArray(m.parsed?.dependencies)) {
      for (const d of m.parsed.dependencies) {
        if (d?.name) allDependencies.add(d.name.toLowerCase());
      }
    }
  }

  // Scan for DB patterns in code
  for (const file of files) {
    if (!file.content || file.content.length < 10) continue;

    for (const dbp of DB_PATTERNS) {
      if (seenDbTypes.has(dbp.type)) continue;
      const matchedByCode = dbp.signatures.some((sig) => sig.test(file.content));
      const matchedByPkg = dbp.packageNames.some((p) => allDependencies.has(p));
      if (matchedByCode || matchedByPkg) {
        databases.push({ type: dbp.type, detectedFrom: matchedByPkg ? "package manifest" : file.relativePath });
        seenDbTypes.add(dbp.type);
      }
    }

    // Migration files
    if (MIGRATION_PATTERNS.some((p) => p.test(file.relativePath))) {
      migrationFiles.push(file.relativePath);
    }

    // Connection strings
    if (/connectionstring|connection_string|DATABASE_URL|MONGO_URI|REDIS_URL/i.test(file.content)) {
      connectionStrings++;
    }
  }

  // ORM detection
  for (const orm of ORM_PACKAGES) {
    if (seenOrms.has(orm.name)) continue;
    const matchedPkg = orm.packageNames.some((p) => allDependencies.has(p));
    if (matchedPkg) {
      // Find version from dependency graph
      const depNode = state.dependencyGraph?.directDependencies?.find(
        (d) => orm.packageNames.includes(d.name.toLowerCase())
      );
      orms.push({ name: orm.name, version: depNode?.version, detectedFrom: "package manifest" });
      seenOrms.add(orm.name);
    }
  }

  // Version constraints from config files
  for (const file of files) {
    const p = file.relativePath.toLowerCase();
    if (p.includes("docker") || p.endsWith(".env") || p.endsWith(".yml") || p.endsWith(".yaml")) {
      const dbVersionMatch = file.content.match(/(?:postgres|mysql|mongo|redis|mssql|mariadb)[:\s]*(\d+[\d.]*)/gi);
      if (dbVersionMatch) {
        versionConstraints.push(...dbVersionMatch.map((m) => m.trim()));
      }
    }
  }

  return {
    databases,
    orms,
    migrationFiles,
    connectionStrings,
    versionConstraints,
    hasDbMigrations: migrationFiles.length > 0,
  };
}

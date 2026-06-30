#!/usr/bin/env node
/**
 * Generic Schema Migration Script
 * 
 * This script compares the database schema between a source and target database
 * and generates SQL migration statements to sync target schema with source.
 * 
 * It reads database credentials from environment variables:
 * - Source DB: SOURCE_MYSQL_HOST, SOURCE_MYSQL_PORT, SOURCE_MYSQL_USER, 
 *              SOURCE_MYSQL_PASSWORD, SOURCE_MYSQL_DATABASE
 *   OR falls back to: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 * 
 * - Target DB: TARGET_MYSQL_HOST, TARGET_MYSQL_PORT, TARGET_MYSQL_USER,
 *              TARGET_MYSQL_PASSWORD, TARGET_MYSQL_DATABASE
 * 
 * Usage:
 *   # Set environment variables
 *   export SOURCE_MYSQL_HOST="source-host"
 *   export SOURCE_MYSQL_USER="source-user"
 *   export SOURCE_MYSQL_PASSWORD="source-password"
 *   export SOURCE_MYSQL_DATABASE="source-db"
 *   
 *   export TARGET_MYSQL_HOST="target-host"
 *   export TARGET_MYSQL_USER="target-user"
 *   export TARGET_MYSQL_PASSWORD="target-password"
 *   export TARGET_MYSQL_DATABASE="target-db"
 *   
 *   # Run migration
 *   npm run migrate-schema:generic
 *   or
 *   tsx scripts/migrate-schema-generic.ts
 * 
 * Output:
 *   Generates a migration SQL file in migrations/ directory with timestamp
 */

// npm run migrate:schema:generic
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Source Database Configuration
// Uses SOURCE_MYSQL_* env vars, falls back to MYSQL_* (for .env lines 20-24)
const SOURCE_DB_CONFIG = {
  host: process.env.SOURCE_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.SOURCE_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.SOURCE_MYSQL_USER || process.env.MYSQL_USER,
  password: process.env.SOURCE_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
  database: process.env.SOURCE_MYSQL_DATABASE || process.env.MYSQL_DATABASE,
  ssl: {
    rejectUnauthorized: false,
  },
};

// Target Database Configuration
// Requires TARGET_MYSQL_* env vars to be set
const TARGET_DB_CONFIG = {
  host: process.env.TARGET_MYSQL_HOST,
  port: Number(process.env.TARGET_MYSQL_PORT || 3306),
  user: process.env.TARGET_MYSQL_USER,
  password: process.env.TARGET_MYSQL_PASSWORD,
  database: process.env.TARGET_MYSQL_DATABASE,
  ssl: {
    rejectUnauthorized: false,
  },
};

interface ColumnInfo {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  COLUMN_TYPE: string;
  EXTRA: string;
  COLUMN_KEY: string;
  COLUMN_COMMENT: string;
}

interface IndexInfo {
  TABLE_NAME: string;
  INDEX_NAME: string;
  COLUMN_NAME: string;
  NON_UNIQUE: number;
  SEQ_IN_INDEX: number;
}

interface ForeignKeyInfo {
  TABLE_NAME: string;
  CONSTRAINT_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  UPDATE_RULE: string;
  DELETE_RULE: string;
}

class GenericSchemaMigrator {
  private sourceConnection: mysql.Connection;
  private targetConnection: mysql.Connection;
  private sourceDb: string;
  private targetDb: string;
  private migrationSQL: string[] = [];
  private migrationName: string;

  constructor(
    sourceConn: mysql.Connection,
    targetConn: mysql.Connection,
    sourceDb: string,
    targetDb: string,
    migrationName?: string
  ) {
    this.sourceConnection = sourceConn;
    this.targetConnection = targetConn;
    this.sourceDb = sourceDb;
    this.targetDb = targetDb;
    this.migrationName = migrationName || `${sourceDb}-to-${targetDb}`;
    
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push(`-- Schema Migration: ${this.migrationName}`);
    this.migrationSQL.push(`-- Generated: ${new Date().toISOString()}`);
    this.migrationSQL.push(`-- Source: ${sourceDb}`);
    this.migrationSQL.push(`-- Target: ${targetDb}`);
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('');
    this.migrationSQL.push('SET FOREIGN_KEY_CHECKS=0;');
    this.migrationSQL.push('');
  }

  async getTables(connection: mysql.Connection, database: string): Promise<string[]> {
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [database]
    );
    return tables.map(row => row.TABLE_NAME);
  }

  async getColumns(connection: mysql.Connection, database: string, tableName: string): Promise<ColumnInfo[]> {
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT 
        COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, 
        COLUMN_TYPE, EXTRA, COLUMN_KEY, COLUMN_COMMENT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, tableName]
    );
    return columns as ColumnInfo[];
  }

  async getIndexes(connection: mysql.Connection, database: string, tableName: string): Promise<IndexInfo[]> {
    const [indexes] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT 
        TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, tableName]
    );
    return indexes as IndexInfo[];
  }

  async getForeignKeys(connection: mysql.Connection, database: string, tableName: string): Promise<ForeignKeyInfo[]> {
    const [fks] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT 
        kcu.TABLE_NAME,
        kcu.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        COALESCE(rc.UPDATE_RULE, 'RESTRICT') as UPDATE_RULE,
        COALESCE(rc.DELETE_RULE, 'RESTRICT') as DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
         AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
       WHERE kcu.TABLE_SCHEMA = ? 
         AND kcu.TABLE_NAME = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY kcu.CONSTRAINT_NAME`,
      [database, tableName]
    );
    return fks as ForeignKeyInfo[];
  }

  async getTableCreateStatement(connection: mysql.Connection, tableName: string): Promise<string> {
    const [result] = await connection.query<mysql.RowDataPacket[]>(
      `SHOW CREATE TABLE \`${tableName}\``
    );
    return result[0]['Create Table'];
  }

  generateColumnDefinition(col: ColumnInfo): string {
    let def = `\`${col.COLUMN_NAME}\` ${col.COLUMN_TYPE}`;
    
    if (col.IS_NULLABLE === 'NO') {
      def += ' NOT NULL';
    }
    
    if (col.COLUMN_DEFAULT !== null) {
      if (col.COLUMN_DEFAULT === 'CURRENT_TIMESTAMP' || col.COLUMN_DEFAULT?.includes('CURRENT_TIMESTAMP')) {
        def += ` DEFAULT ${col.COLUMN_DEFAULT}`;
      } else {
        def += ` DEFAULT '${col.COLUMN_DEFAULT}'`;
      }
    }
    
    if (col.EXTRA) {
      def += ` ${col.EXTRA}`;
    }
    
    if (col.COLUMN_COMMENT) {
      def += ` COMMENT '${col.COLUMN_COMMENT.replace(/'/g, "''")}'`;
    }
    
    return def;
  }

  async migrateSchema() {
    console.log(`🔄 Starting schema migration from ${this.sourceDb} to ${this.targetDb}...\n`);

    // Get tables from both databases
    const sourceTables = await this.getTables(this.sourceConnection, this.sourceDb);
    const targetTables = await this.getTables(this.targetConnection, this.targetDb);

    console.log(`📋 Source Database (${this.sourceDb}): ${sourceTables.length} tables`);
    console.log(`📋 Target Database (${this.targetDb}): ${targetTables.length} tables\n`);

    // Find missing tables in target
    const missingTables = sourceTables.filter(table => !targetTables.includes(table));
    const extraTables = targetTables.filter(table => !sourceTables.includes(table));

    // Create missing tables
    if (missingTables.length > 0) {
      console.log(`➕ Creating ${missingTables.length} missing table(s)...`);
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- Create Missing Tables');
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('');

      for (const tableName of missingTables) {
        console.log(`   Creating table: ${tableName}`);
        const createStatement = await this.getTableCreateStatement(this.sourceConnection, tableName);
        this.migrationSQL.push(`-- Create table: ${tableName}`);
        this.migrationSQL.push(createStatement + ';');
        this.migrationSQL.push('');
      }
    } else {
      console.log('✅ All tables exist in target database');
    }

    // Warn about extra tables in target
    if (extraTables.length > 0) {
      console.log(`⚠️  Warning: ${extraTables.length} table(s) exist in target but not in source:`);
      extraTables.forEach(table => console.log(`   - ${table}`));
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- WARNING: Tables in target but not in source (not modified)');
      this.migrationSQL.push('-- ============================================');
      extraTables.forEach(table => {
        this.migrationSQL.push(`-- Table: ${table} (exists in target but not in source)`);
      });
      this.migrationSQL.push('');
    }

    // Compare common tables
    const commonTables = sourceTables.filter(table => targetTables.includes(table));
    console.log(`\n🔍 Comparing ${commonTables.length} common table(s)...\n`);

    if (commonTables.length > 0) {
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- Modify Existing Tables');
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('');

      for (const tableName of commonTables) {
        await this.migrateTable(tableName);
      }
    }

    // Re-enable foreign key checks
    this.migrationSQL.push('');
    this.migrationSQL.push('SET FOREIGN_KEY_CHECKS=1;');
    this.migrationSQL.push('');
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('-- Migration Complete');
    this.migrationSQL.push('-- ============================================');
  }

  async migrateTable(tableName: string) {
    const sourceColumns = await this.getColumns(this.sourceConnection, this.sourceDb, tableName);
    const targetColumns = await this.getColumns(this.targetConnection, this.targetDb, tableName);

    const sourceColumnMap = new Map(sourceColumns.map(col => [col.COLUMN_NAME, col]));
    const targetColumnMap = new Map(targetColumns.map(col => [col.COLUMN_NAME, col]));

    // Find missing columns
    const missingColumns = sourceColumns.filter(col => !targetColumnMap.has(col.COLUMN_NAME));
    
    // Find columns that need modification
    const modifiedColumns: Array<{ source: ColumnInfo; target: ColumnInfo }> = [];
    for (const sourceCol of sourceColumns) {
      const targetCol = targetColumnMap.get(sourceCol.COLUMN_NAME);
      if (targetCol) {
        // Compare column definitions
        const sourceDef = this.generateColumnDefinition(sourceCol);
        const targetDef = this.generateColumnDefinition(targetCol);
        if (sourceDef !== targetDef) {
          modifiedColumns.push({ source: sourceCol, target: targetCol });
        }
      }
    }

    // Find extra columns in target (warn only)
    const extraColumns = targetColumns.filter(col => !sourceColumnMap.has(col.COLUMN_NAME));

    if (missingColumns.length > 0 || modifiedColumns.length > 0 || extraColumns.length > 0) {
      this.migrationSQL.push(`-- Table: ${tableName}`);
      
      // Add missing columns
      for (const col of missingColumns) {
        const colDef = this.generateColumnDefinition(col);
        const position = sourceColumns.indexOf(col);
        let positionClause = '';
        
        if (position > 0) {
          const prevCol = sourceColumns[position - 1];
          positionClause = ` AFTER \`${prevCol.COLUMN_NAME}\``;
        } else {
          positionClause = ' FIRST';
        }
        
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${colDef}${positionClause};`);
        console.log(`   ➕ ${tableName}.${col.COLUMN_NAME}: Added`);
      }

      // Modify existing columns
      for (const { source, target } of modifiedColumns) {
        const colDef = this.generateColumnDefinition(source);
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` MODIFY COLUMN ${colDef};`);
        console.log(`   🔄 ${tableName}.${source.COLUMN_NAME}: Modified`);
      }

      // Warn about extra columns
      if (extraColumns.length > 0) {
        this.migrationSQL.push(`-- WARNING: Columns in target but not in source (not modified):`);
        extraColumns.forEach(col => {
          this.migrationSQL.push(`--   - ${col.COLUMN_NAME}`);
          console.log(`   ⚠️  ${tableName}.${col.COLUMN_NAME}: Exists in target but not in source`);
        });
      }

      this.migrationSQL.push('');
    }

    // Compare indexes
    await this.migrateIndexes(tableName);
    
    // Compare foreign keys
    await this.migrateForeignKeys(tableName);
  }

  async migrateIndexes(tableName: string) {
    const sourceIndexes = await this.getIndexes(this.sourceConnection, this.sourceDb, tableName);
    const targetIndexes = await this.getIndexes(this.targetConnection, this.targetDb, tableName);

    // Group indexes by name
    const sourceIndexMap = new Map<string, IndexInfo[]>();
    const targetIndexMap = new Map<string, IndexInfo[]>();

    for (const idx of sourceIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!sourceIndexMap.has(idx.INDEX_NAME)) {
          sourceIndexMap.set(idx.INDEX_NAME, []);
        }
        sourceIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    for (const idx of targetIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!targetIndexMap.has(idx.INDEX_NAME)) {
          targetIndexMap.set(idx.INDEX_NAME, []);
        }
        targetIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    // Find missing indexes
    for (const [indexName, columns] of sourceIndexMap.entries()) {
      if (!targetIndexMap.has(indexName)) {
        const isUnique = columns[0].NON_UNIQUE === 0;
        const columnList = columns
          .sort((a, b) => a.SEQ_IN_INDEX - b.SEQ_IN_INDEX)
          .map(c => `\`${c.COLUMN_NAME}\``)
          .join(', ');
        
        const uniqueClause = isUnique ? 'UNIQUE ' : '';
        this.migrationSQL.push(`CREATE ${uniqueClause}INDEX \`${indexName}\` ON \`${tableName}\` (${columnList});`);
        console.log(`   ➕ Index ${tableName}.${indexName}: Added`);
      }
    }
  }

  async migrateForeignKeys(tableName: string) {
    const sourceFks = await this.getForeignKeys(this.sourceConnection, this.sourceDb, tableName);
    const targetFks = await this.getForeignKeys(this.targetConnection, this.targetDb, tableName);

    const sourceFkMap = new Map(sourceFks.map(fk => [fk.CONSTRAINT_NAME, fk]));
    const targetFkMap = new Map(targetFks.map(fk => [fk.CONSTRAINT_NAME, fk]));

    // Find missing foreign keys
    for (const [fkName, sourceFk] of sourceFkMap.entries()) {
      if (!targetFkMap.has(fkName)) {
        this.migrationSQL.push(
          `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${fkName}\` ` +
          `FOREIGN KEY (\`${sourceFk.COLUMN_NAME}\`) ` +
          `REFERENCES \`${sourceFk.REFERENCED_TABLE_NAME}\` (\`${sourceFk.REFERENCED_COLUMN_NAME}\`) ` +
          `ON UPDATE ${sourceFk.UPDATE_RULE} ON DELETE ${sourceFk.DELETE_RULE};`
        );
        console.log(`   ➕ Foreign Key ${tableName}.${fkName}: Added`);
      }
    }
  }

  getMigrationSQL(): string {
    return this.migrationSQL.join('\n');
  }

  getMigrationName(): string {
    return this.migrationName;
  }
}

function validateConfig(config: any, name: string): void {
  const required = ['host', 'user', 'password', 'database'];
  const missing: string[] = [];

  for (const field of required) {
    if (!config[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required ${name} database configuration: ${missing.join(', ')}\n` +
      `Please set the following environment variables:\n` +
      `  ${name === 'source' ? 'SOURCE_MYSQL_' : 'TARGET_MYSQL_'}${missing.map(f => f.toUpperCase()).join(', ')}\n` +
      `Or for source, ensure MYSQL_* variables are set in .env file (lines 20-24)`
    );
  }
}

async function main() {
  console.log('🚀 Generic Schema Migration Script\n');
  console.log('='.repeat(60));

  // Validate configurations
  try {
    validateConfig(SOURCE_DB_CONFIG, 'source');
    validateConfig(TARGET_DB_CONFIG, 'target');
  } catch (error: any) {
    console.error('\n❌ Configuration Error:', error.message);
    console.error('\nUsage:');
    console.error('  Set environment variables:');
    console.error('    SOURCE_MYSQL_HOST, SOURCE_MYSQL_USER, SOURCE_MYSQL_PASSWORD, SOURCE_MYSQL_DATABASE');
    console.error('    (or use MYSQL_* for source from .env)');
    console.error('    TARGET_MYSQL_HOST, TARGET_MYSQL_USER, TARGET_MYSQL_PASSWORD, TARGET_MYSQL_DATABASE');
    process.exit(1);
  }

  let sourceConnection: mysql.Connection | null = null;
  let targetConnection: mysql.Connection | null = null;

  try {
    // Connect to databases
    console.log('\n🔗 Connecting to databases...');
    console.log(`   Source: ${SOURCE_DB_CONFIG.host}/${SOURCE_DB_CONFIG.database}`);
    console.log(`   Target: ${TARGET_DB_CONFIG.host}/${TARGET_DB_CONFIG.database}`);
    
    sourceConnection = await mysql.createConnection(SOURCE_DB_CONFIG);
    console.log('✅ Connected to source database');

    targetConnection = await mysql.createConnection(TARGET_DB_CONFIG);
    console.log('✅ Connected to target database');

    // Run migration
    const migrator = new GenericSchemaMigrator(
      sourceConnection,
      targetConnection,
      SOURCE_DB_CONFIG.database!,
      TARGET_DB_CONFIG.database!
    );
    await migrator.migrateSchema();

    // Save migration SQL to file
    const migrationSQL = migrator.getMigrationSQL();
    const timestamp = Date.now();
    const migrationName = migrator.getMigrationName();
    const outputPath = path.join(
      process.cwd(),
      'migrations',
      `${timestamp}-${migrationName}-migration.sql`
    );
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, migrationSQL, 'utf-8');
    console.log(`\n✅ Migration SQL saved to: ${outputPath}`);
    console.log('\n📝 Review the migration SQL before applying it to target database.');
    console.log('   You can apply it using:');
    console.log(`   mysql -h ${TARGET_DB_CONFIG.host} -u ${TARGET_DB_CONFIG.user} -p ${TARGET_DB_CONFIG.database} < ${outputPath}`);

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    if (sourceConnection) await sourceConnection.end();
    if (targetConnection) await targetConnection.end();
    console.log('\n🔌 Database connections closed');
  }
}

main();

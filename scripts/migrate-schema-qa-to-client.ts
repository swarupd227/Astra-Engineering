#!/usr/bin/env node
/**
 * Schema Migration Script: QA to CLIENT
 *
 * This script compares the database schema between QA and a Client environment
 * and generates SQL migration statements to sync the Client schema with QA.
 *
 * Usage:
 *   npx tsx scripts/migrate-schema-qa-to-client.ts
 *
 * The generated SQL file will be:
 *   migrations/qa-to-client-migration.sql
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// QA Database Configuration (Source)
// You can either keep these hardcoded or move them to env vars if preferred.
const QA_DB_CONFIG = {
  host: process.env.QA_MYSQL_HOST || 'qadevxmysqlserver.mysql.database.azure.com',
  port: Number(process.env.QA_MYSQL_PORT || 3306),
  user: process.env.QA_MYSQL_USER || 'devxadmin',
  password: process.env.QA_MYSQL_PASSWORD || 'REDACTED_MYSQL_PASSWORD',
  database: process.env.QA_MYSQL_DATABASE || 'qadevxdb',
  ssl: {
    rejectUnauthorized: false,
  },
};

// CLIENT Database Configuration (Target)
// IMPORTANT: Fill these in for your client environment, or set them via env vars.
//   CLIENT_MYSQL_HOST, CLIENT_MYSQL_PORT, CLIENT_MYSQL_USER,
//   CLIENT_MYSQL_PASSWORD, CLIENT_MYSQL_DATABASE
const CLIENT_DB_CONFIG = {
  host: process.env.CLIENT_MYSQL_HOST || '<client-mysql-host>',
  port: Number(process.env.CLIENT_MYSQL_PORT || 3306),
  user: process.env.CLIENT_MYSQL_USER || '<client-mysql-user>',
  password: process.env.CLIENT_MYSQL_PASSWORD || '<client-mysql-password>',
  database: process.env.CLIENT_MYSQL_DATABASE || '<client-database-name>',
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

class SchemaMigrator {
  private qaConnection: mysql.Connection;
  private clientConnection: mysql.Connection;
  private migrationSQL: string[] = [];

  constructor(qaConn: mysql.Connection, clientConn: mysql.Connection) {
    this.qaConnection = qaConn;
    this.clientConnection = clientConn;
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('-- Schema Migration: QA to CLIENT');
    this.migrationSQL.push(`-- Generated: ${new Date().toISOString()}`);
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
    console.log('🔄 Starting schema migration from QA to CLIENT...\n');

    // Get tables from both databases
    const qaTables = await this.getTables(this.qaConnection, QA_DB_CONFIG.database);
    const clientTables = await this.getTables(this.clientConnection, CLIENT_DB_CONFIG.database);

    console.log(`📋 QA Database: ${qaTables.length} tables`);
    console.log(`📋 CLIENT Database: ${clientTables.length} tables\n`);

    // Find missing tables in CLIENT
    const missingTables = qaTables.filter(table => !clientTables.includes(table));
    const extraTables = clientTables.filter(table => !qaTables.includes(table));

    // Create missing tables
    if (missingTables.length > 0) {
      console.log(`➕ Creating ${missingTables.length} missing table(s) in CLIENT...`);
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- Create Missing Tables');
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('');

      for (const tableName of missingTables) {
        console.log(`   Creating table: ${tableName}`);
        const createStatement = await this.getTableCreateStatement(this.qaConnection, tableName);
        this.migrationSQL.push(`-- Create table: ${tableName}`);
        this.migrationSQL.push(createStatement + ';');
        this.migrationSQL.push('');
      }
    }

    // Warn about extra tables in CLIENT
    if (extraTables.length > 0) {
      console.log(`⚠️  Warning: ${extraTables.length} table(s) exist in CLIENT but not in QA:`);
      extraTables.forEach(table => console.log(`   - ${table}`));
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- WARNING: Tables in CLIENT but not in QA (not modified)');
      this.migrationSQL.push('-- ============================================');
      extraTables.forEach(table => {
        this.migrationSQL.push(`-- Table: ${table} (exists in CLIENT but not in QA)`);
      });
      this.migrationSQL.push('');
    }

    // Compare common tables
    const commonTables = qaTables.filter(table => clientTables.includes(table));
    console.log(`\n🔍 Comparing ${commonTables.length} common table(s)...\n`);

    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('-- Modify Existing Tables');
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('');

    for (const tableName of commonTables) {
      await this.migrateTable(tableName);
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
    const qaColumns = await this.getColumns(this.qaConnection, QA_DB_CONFIG.database, tableName);
    const clientColumns = await this.getColumns(this.clientConnection, CLIENT_DB_CONFIG.database, tableName);

    const qaColumnMap = new Map(qaColumns.map(col => [col.COLUMN_NAME, col]));
    const clientColumnMap = new Map(clientColumns.map(col => [col.COLUMN_NAME, col]));

    // Find missing columns
    const missingColumns = qaColumns.filter(col => !clientColumnMap.has(col.COLUMN_NAME));
    
    // Find columns that need modification
    const modifiedColumns: Array<{ qa: ColumnInfo; client: ColumnInfo }> = [];
    for (const qaCol of qaColumns) {
      const clientCol = clientColumnMap.get(qaCol.COLUMN_NAME);
      if (clientCol) {
        // Compare column definitions
        const qaDef = this.generateColumnDefinition(qaCol);
        const clientDef = this.generateColumnDefinition(clientCol);
        if (qaDef !== clientDef) {
          modifiedColumns.push({ qa: qaCol, client: clientCol });
        }
      }
    }

    // Find extra columns in CLIENT (warn only)
    const extraColumns = clientColumns.filter(col => !qaColumnMap.has(col.COLUMN_NAME));

    if (missingColumns.length > 0 || modifiedColumns.length > 0 || extraColumns.length > 0) {
      this.migrationSQL.push(`-- Table: ${tableName}`);
      
      // Add missing columns
      for (const col of missingColumns) {
        const colDef = this.generateColumnDefinition(col);
        const position = qaColumns.indexOf(col);
        let positionClause = '';
        
        if (position > 0) {
          const prevCol = qaColumns[position - 1];
          positionClause = ` AFTER \`${prevCol.COLUMN_NAME}\``;
        } else {
          positionClause = ' FIRST';
        }
        
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${colDef}${positionClause};`);
        console.log(`   ➕ ${tableName}.${col.COLUMN_NAME}: Added`);
      }

      // Modify existing columns
      for (const { qa } of modifiedColumns) {
        const colDef = this.generateColumnDefinition(qa);
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` MODIFY COLUMN ${colDef};`);
        console.log(`   🔄 ${tableName}.${qa.COLUMN_NAME}: Modified`);
      }

      // Warn about extra columns
      if (extraColumns.length > 0) {
        this.migrationSQL.push(`-- WARNING: Columns in CLIENT but not in QA (not modified):`);
        extraColumns.forEach(col => {
          this.migrationSQL.push(`--   - ${col.COLUMN_NAME}`);
          console.log(`   ⚠️  ${tableName}.${col.COLUMN_NAME}: Exists in CLIENT but not in QA`);
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
    const qaIndexes = await this.getIndexes(this.qaConnection, QA_DB_CONFIG.database, tableName);
    const clientIndexes = await this.getIndexes(this.clientConnection, CLIENT_DB_CONFIG.database, tableName);

    // Group indexes by name
    const qaIndexMap = new Map<string, IndexInfo[]>();
    const clientIndexMap = new Map<string, IndexInfo[]>();

    for (const idx of qaIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!qaIndexMap.has(idx.INDEX_NAME)) {
          qaIndexMap.set(idx.INDEX_NAME, []);
        }
        qaIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    for (const idx of clientIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!clientIndexMap.has(idx.INDEX_NAME)) {
          clientIndexMap.set(idx.INDEX_NAME, []);
        }
        clientIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    // Find missing indexes
    for (const [indexName, columns] of qaIndexMap.entries()) {
      if (!clientIndexMap.has(indexName)) {
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
    const qaFks = await this.getForeignKeys(this.qaConnection, QA_DB_CONFIG.database, tableName);
    const clientFks = await this.getForeignKeys(this.clientConnection, CLIENT_DB_CONFIG.database, tableName);

    const qaFkMap = new Map(qaFks.map(fk => [fk.CONSTRAINT_NAME, fk]));
    const clientFkMap = new Map(clientFks.map(fk => [fk.CONSTRAINT_NAME, fk]));

    // Find missing foreign keys
    for (const [fkName, qaFk] of qaFkMap.entries()) {
      if (!clientFkMap.has(fkName)) {
        this.migrationSQL.push(
          `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${fkName}\` ` +
          `FOREIGN KEY (\`${qaFk.COLUMN_NAME}\`) ` +
          `REFERENCES \`${qaFk.REFERENCED_TABLE_NAME}\` (\`${qaFk.REFERENCED_COLUMN_NAME}\`) ` +
          `ON UPDATE ${qaFk.UPDATE_RULE} ON DELETE ${qaFk.DELETE_RULE};`
        );
        console.log(`   ➕ Foreign Key ${tableName}.${fkName}: Added`);
      }
    }
  }

  getMigrationSQL(): string {
    return this.migrationSQL.join('\n');
  }
}

async function main() {
  console.log('🚀 Schema Migration: QA → CLIENT\n');
  console.log('='.repeat(60));

  let qaConnection: mysql.Connection | null = null;
  let clientConnection: mysql.Connection | null = null;

  try {
    // Basic validation of client config
    if (
      CLIENT_DB_CONFIG.host.startsWith('<') ||
      CLIENT_DB_CONFIG.user.startsWith('<') ||
      CLIENT_DB_CONFIG.database.startsWith('<')
    ) {
      console.error('❌ CLIENT DB configuration is not set. Please set CLIENT_MYSQL_* env vars or edit CLIENT_DB_CONFIG in scripts/migrate-schema-qa-to-client.ts');
      process.exit(1);
    }

    // Connect to databases
    console.log('\n🔗 Connecting to databases...');
    qaConnection = await mysql.createConnection(QA_DB_CONFIG);
    console.log('✅ Connected to QA database');

    clientConnection = await mysql.createConnection(CLIENT_DB_CONFIG);
    console.log('✅ Connected to CLIENT database');

    // Run migration diff generation
    const migrator = new SchemaMigrator(qaConnection, clientConnection);
    await migrator.migrateSchema();

    // Save migration SQL to file
    const migrationSQL = migrator.getMigrationSQL();
    const outputPath = path.join(process.cwd(), 'migrations', 'qa-to-client-migration.sql');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, migrationSQL, 'utf-8');
    console.log(`\n✅ Migration SQL saved to: ${outputPath}`);
    console.log('\n📝 Review the migration SQL before applying it to the CLIENT database.');
    console.log('   You can apply it using:');
    console.log('   mysql -h <client-host> -u <client-user> -p <client-database> < migrations/qa-to-client-migration.sql');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (qaConnection) await qaConnection.end();
    if (clientConnection) await clientConnection.end();
    console.log('\n🔌 Database connections closed');
  }
}

main();



#!/usr/bin/env node
/**
 * Schema Migration Script: QA to UAT
 * 
 * This script compares the database schema between QA and UAT environments
 * and generates SQL migration statements to sync UAT schema with QA.
 * 
 * Usage:
 *   npm run migrate-schema:qa-to-uat
 *   or
 *   ts-node scripts/migrate-schema-qa-to-uat.ts
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// QA Database Configuration (Source)
const QA_DB_CONFIG = {
  host: 'qadevxmysqlserver.mysql.database.azure.com',
  port: 3306,
  user: 'devxadmin',
  password: 'REDACTED_MYSQL_PASSWORD',
  database: 'qadevxdb',
  ssl: {
    rejectUnauthorized: false,
  },
};

// UAT Database Configuration (Target)
const UAT_DB_CONFIG = {
  host: 'uatdevxmysqlserver.mysql.database.azure.com',
  port: 3306,
  user: 'devxadmin',
  password: 'REDACTED_MYSQL_PASSWORD',
  database: 'uatdevxdb',
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
  private uatConnection: mysql.Connection;
  private migrationSQL: string[] = [];

  constructor(qaConn: mysql.Connection, uatConn: mysql.Connection) {
    this.qaConnection = qaConn;
    this.uatConnection = uatConn;
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('-- Schema Migration: QA to UAT');
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
    console.log('🔄 Starting schema migration from QA to UAT...\n');

    // Get tables from both databases
    const qaTables = await this.getTables(this.qaConnection, QA_DB_CONFIG.database);
    const uatTables = await this.getTables(this.uatConnection, UAT_DB_CONFIG.database);

    console.log(`📋 QA Database: ${qaTables.length} tables`);
    console.log(`📋 UAT Database: ${uatTables.length} tables\n`);

    // Find missing tables in UAT
    const missingTables = qaTables.filter(table => !uatTables.includes(table));
    const extraTables = uatTables.filter(table => !qaTables.includes(table));

    // Create missing tables
    if (missingTables.length > 0) {
      console.log(`➕ Creating ${missingTables.length} missing table(s)...`);
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

    // Warn about extra tables in UAT
    if (extraTables.length > 0) {
      console.log(`⚠️  Warning: ${extraTables.length} table(s) exist in UAT but not in QA:`);
      extraTables.forEach(table => console.log(`   - ${table}`));
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- WARNING: Tables in UAT but not in QA (not modified)');
      this.migrationSQL.push('-- ============================================');
      extraTables.forEach(table => {
        this.migrationSQL.push(`-- Table: ${table} (exists in UAT but not in QA)`);
      });
      this.migrationSQL.push('');
    }

    // Compare common tables
    const commonTables = qaTables.filter(table => uatTables.includes(table));
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
    const uatColumns = await this.getColumns(this.uatConnection, UAT_DB_CONFIG.database, tableName);

    const qaColumnMap = new Map(qaColumns.map(col => [col.COLUMN_NAME, col]));
    const uatColumnMap = new Map(uatColumns.map(col => [col.COLUMN_NAME, col]));

    // Find missing columns
    const missingColumns = qaColumns.filter(col => !uatColumnMap.has(col.COLUMN_NAME));
    
    // Find columns that need modification
    const modifiedColumns: Array<{ qa: ColumnInfo; uat: ColumnInfo }> = [];
    for (const qaCol of qaColumns) {
      const uatCol = uatColumnMap.get(qaCol.COLUMN_NAME);
      if (uatCol) {
        // Compare column definitions
        const qaDef = this.generateColumnDefinition(qaCol);
        const uatDef = this.generateColumnDefinition(uatCol);
        if (qaDef !== uatDef) {
          modifiedColumns.push({ qa: qaCol, uat: uatCol });
        }
      }
    }

    // Find extra columns in UAT (warn only)
    const extraColumns = uatColumns.filter(col => !qaColumnMap.has(col.COLUMN_NAME));

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
      for (const { qa, uat } of modifiedColumns) {
        const colDef = this.generateColumnDefinition(qa);
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` MODIFY COLUMN ${colDef};`);
        console.log(`   🔄 ${tableName}.${qa.COLUMN_NAME}: Modified`);
      }

      // Warn about extra columns
      if (extraColumns.length > 0) {
        this.migrationSQL.push(`-- WARNING: Columns in UAT but not in QA (not modified):`);
        extraColumns.forEach(col => {
          this.migrationSQL.push(`--   - ${col.COLUMN_NAME}`);
          console.log(`   ⚠️  ${tableName}.${col.COLUMN_NAME}: Exists in UAT but not in QA`);
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
    const uatIndexes = await this.getIndexes(this.uatConnection, UAT_DB_CONFIG.database, tableName);

    // Group indexes by name
    const qaIndexMap = new Map<string, IndexInfo[]>();
    const uatIndexMap = new Map<string, IndexInfo[]>();

    for (const idx of qaIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!qaIndexMap.has(idx.INDEX_NAME)) {
          qaIndexMap.set(idx.INDEX_NAME, []);
        }
        qaIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    for (const idx of uatIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!uatIndexMap.has(idx.INDEX_NAME)) {
          uatIndexMap.set(idx.INDEX_NAME, []);
        }
        uatIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    // Find missing indexes
    for (const [indexName, columns] of qaIndexMap.entries()) {
      if (!uatIndexMap.has(indexName)) {
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
    const uatFks = await this.getForeignKeys(this.uatConnection, UAT_DB_CONFIG.database, tableName);

    const qaFkMap = new Map(qaFks.map(fk => [fk.CONSTRAINT_NAME, fk]));
    const uatFkMap = new Map(uatFks.map(fk => [fk.CONSTRAINT_NAME, fk]));

    // Find missing foreign keys
    for (const [fkName, qaFk] of qaFkMap.entries()) {
      if (!uatFkMap.has(fkName)) {
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
  console.log('🚀 Schema Migration: QA → UAT\n');
  console.log('='.repeat(60));

  let qaConnection: mysql.Connection | null = null;
  let uatConnection: mysql.Connection | null = null;

  try {
    // Connect to databases
    console.log('\n🔗 Connecting to databases...');
    qaConnection = await mysql.createConnection(QA_DB_CONFIG);
    console.log('✅ Connected to QA database');

    uatConnection = await mysql.createConnection(UAT_DB_CONFIG);
    console.log('✅ Connected to UAT database');

    // Run migration
    const migrator = new SchemaMigrator(qaConnection, uatConnection);
    await migrator.migrateSchema();

    // Save migration SQL to file
    const migrationSQL = migrator.getMigrationSQL();
    // Use process.cwd() instead of __dirname for tsx/ESM compatibility
    const outputPath = path.join(process.cwd(), 'migrations', 'qa-to-uat-migration.sql');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, migrationSQL, 'utf-8');
    console.log(`\n✅ Migration SQL saved to: ${outputPath}`);
    console.log('\n📝 Review the migration SQL before applying it to UAT database.');
    console.log('   You can apply it using: mysql -h <host> -u <user> -p <database> < migration-file.sql');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (qaConnection) await qaConnection.end();
    if (uatConnection) await uatConnection.end();
    console.log('\n🔌 Database connections closed');
  }
}

main();


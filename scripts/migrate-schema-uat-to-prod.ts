#!/usr/bin/env node
/**
 * Schema Migration Script: UAT to PROD
 * 
 * This script compares the database schema between UAT and PROD environments
 * and generates SQL migration statements to sync PROD schema with UAT.
 * 
 * Usage:
 *   npx tsx scripts/migrate-schema-uat-to-prod.ts
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// UAT Database Configuration (Source)
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

// PROD Database Configuration (Target)
const PROD_DB_CONFIG = {
  host: 'devxserver.mysql.database.azure.com',
  port: 3306,
  user: 'devxadmin',
  password: 'REDACTED_MYSQL_PASSWORD',
  database: 'devxdb',
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
  private sourceConnection: mysql.Connection;
  private targetConnection: mysql.Connection;
  private migrationSQL: string[] = [];

  constructor(sourceConn: mysql.Connection, targetConn: mysql.Connection) {
    this.sourceConnection = sourceConn;
    this.targetConnection = targetConn;
    this.migrationSQL.push('-- ============================================');
    this.migrationSQL.push('-- Schema Migration: UAT to PROD');
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
    console.log('🔄 Starting schema migration from UAT to PROD...\n');

    // Get tables from both databases
    const uatTables = await this.getTables(this.sourceConnection, UAT_DB_CONFIG.database);
    const prodTables = await this.getTables(this.targetConnection, PROD_DB_CONFIG.database);

    console.log(`📋 UAT Database: ${uatTables.length} tables`);
    console.log(`📋 PROD Database: ${prodTables.length} tables\n`);

    // Find missing tables in PROD
    const missingTables = uatTables.filter(table => !prodTables.includes(table));
    const extraTables = prodTables.filter(table => !uatTables.includes(table));

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
    }

    // Warn about extra tables in PROD
    if (extraTables.length > 0) {
      console.log(`⚠️  Warning: ${extraTables.length} table(s) exist in PROD but not in UAT:`);
      extraTables.forEach(table => console.log(`   - ${table}`));
      this.migrationSQL.push('-- ============================================');
      this.migrationSQL.push('-- WARNING: Tables in PROD but not in UAT (not modified)');
      this.migrationSQL.push('-- ============================================');
      extraTables.forEach(table => {
        this.migrationSQL.push(`-- Table: ${table} (exists in PROD but not in UAT)`);
      });
      this.migrationSQL.push('');
    }

    // Compare common tables
    const commonTables = uatTables.filter(table => prodTables.includes(table));
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
    const uatColumns = await this.getColumns(this.sourceConnection, UAT_DB_CONFIG.database, tableName);
    const prodColumns = await this.getColumns(this.targetConnection, PROD_DB_CONFIG.database, tableName);

    const uatColumnMap = new Map(uatColumns.map(col => [col.COLUMN_NAME, col]));
    const prodColumnMap = new Map(prodColumns.map(col => [col.COLUMN_NAME, col]));

    // Find missing columns
    const missingColumns = uatColumns.filter(col => !prodColumnMap.has(col.COLUMN_NAME));
    
    // Find columns that need modification
    const modifiedColumns: Array<{ uat: ColumnInfo; prod: ColumnInfo }> = [];
    for (const uatCol of uatColumns) {
      const prodCol = prodColumnMap.get(uatCol.COLUMN_NAME);
      if (prodCol) {
        // Compare column definitions
        const uatDef = this.generateColumnDefinition(uatCol);
        const prodDef = this.generateColumnDefinition(prodCol);
        if (uatDef !== prodDef) {
          modifiedColumns.push({ uat: uatCol, prod: prodCol });
        }
      }
    }

    // Find extra columns in PROD (warn only)
    const extraColumns = prodColumns.filter(col => !uatColumnMap.has(col.COLUMN_NAME));

    if (missingColumns.length > 0 || modifiedColumns.length > 0 || extraColumns.length > 0) {
      this.migrationSQL.push(`-- Table: ${tableName}`);
      
      // Add missing columns
      for (const col of missingColumns) {
        const colDef = this.generateColumnDefinition(col);
        const position = uatColumns.indexOf(col);
        let positionClause = '';
        
        if (position > 0) {
          const prevCol = uatColumns[position - 1];
          positionClause = ` AFTER \`${prevCol.COLUMN_NAME}\``;
        } else {
          positionClause = ' FIRST';
        }
        
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${colDef}${positionClause};`);
        console.log(`   ➕ ${tableName}.${col.COLUMN_NAME}: Added`);
      }

      // Modify existing columns
      for (const { uat, prod } of modifiedColumns) {
        const colDef = this.generateColumnDefinition(uat);
        this.migrationSQL.push(`ALTER TABLE \`${tableName}\` MODIFY COLUMN ${colDef};`);
        console.log(`   🔄 ${tableName}.${uat.COLUMN_NAME}: Modified`);
      }

      // Warn about extra columns
      if (extraColumns.length > 0) {
        this.migrationSQL.push(`-- WARNING: Columns in PROD but not in UAT (not modified):`);
        extraColumns.forEach(col => {
          this.migrationSQL.push(`--   - ${col.COLUMN_NAME}`);
          console.log(`   ⚠️  ${tableName}.${col.COLUMN_NAME}: Exists in PROD but not in UAT`);
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
    const uatIndexes = await this.getIndexes(this.sourceConnection, UAT_DB_CONFIG.database, tableName);
    const prodIndexes = await this.getIndexes(this.targetConnection, PROD_DB_CONFIG.database, tableName);

    // Group indexes by name
    const uatIndexMap = new Map<string, IndexInfo[]>();
    const prodIndexMap = new Map<string, IndexInfo[]>();

    for (const idx of uatIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!uatIndexMap.has(idx.INDEX_NAME)) {
          uatIndexMap.set(idx.INDEX_NAME, []);
        }
        uatIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    for (const idx of prodIndexes) {
      if (idx.INDEX_NAME !== 'PRIMARY') {
        if (!prodIndexMap.has(idx.INDEX_NAME)) {
          prodIndexMap.set(idx.INDEX_NAME, []);
        }
        prodIndexMap.get(idx.INDEX_NAME)!.push(idx);
      }
    }

    // Find missing indexes
    for (const [indexName, columns] of uatIndexMap.entries()) {
      if (!prodIndexMap.has(indexName)) {
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
    const uatFks = await this.getForeignKeys(this.sourceConnection, UAT_DB_CONFIG.database, tableName);
    const prodFks = await this.getForeignKeys(this.targetConnection, PROD_DB_CONFIG.database, tableName);

    const uatFkMap = new Map(uatFks.map(fk => [fk.CONSTRAINT_NAME, fk]));
    const prodFkMap = new Map(prodFks.map(fk => [fk.CONSTRAINT_NAME, fk]));

    // Find missing foreign keys
    for (const [fkName, uatFk] of uatFkMap.entries()) {
      if (!prodFkMap.has(fkName)) {
        this.migrationSQL.push(
          `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${fkName}\` ` +
          `FOREIGN KEY (\`${uatFk.COLUMN_NAME}\`) ` +
          `REFERENCES \`${uatFk.REFERENCED_TABLE_NAME}\` (\`${uatFk.REFERENCED_COLUMN_NAME}\`) ` +
          `ON UPDATE ${uatFk.UPDATE_RULE} ON DELETE ${uatFk.DELETE_RULE};`
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
  console.log('🚀 Schema Migration: UAT → PROD\n');
  console.log('='.repeat(60));
  console.log('⚠️  WARNING: This will migrate schema to PRODUCTION!');
  console.log('='.repeat(60));

  let uatConnection: mysql.Connection | null = null;
  let prodConnection: mysql.Connection | null = null;

  try {
    // Connect to databases
    console.log('\n🔗 Connecting to databases...');
    uatConnection = await mysql.createConnection(UAT_DB_CONFIG);
    console.log('✅ Connected to UAT database');

    prodConnection = await mysql.createConnection(PROD_DB_CONFIG);
    console.log('✅ Connected to PROD database');

    // Run migration
    const migrator = new SchemaMigrator(uatConnection, prodConnection);
    await migrator.migrateSchema();

    // Save migration SQL to file
    const migrationSQL = migrator.getMigrationSQL();
    const outputPath = path.join(process.cwd(), 'migrations', 'uat-to-prod-migration.sql');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, migrationSQL, 'utf-8');
    console.log(`\n✅ Migration SQL saved to: ${outputPath}`);
    console.log('\n📝 Review the migration SQL before applying it to PROD database.');
    console.log('   You can apply it using: npx tsx scripts/apply-migration-to-prod.ts');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (uatConnection) await uatConnection.end();
    if (prodConnection) await prodConnection.end();
    console.log('\n🔌 Database connections closed');
  }
}

main();


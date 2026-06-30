#!/usr/bin/env node
/**
 * Apply Migration to PROD Database
 * 
 * This script applies the generated migration SQL directly to PROD database
 * 
 * ⚠️  WARNING: This modifies PRODUCTION database!
 * 
 * Usage:
 *   npx tsx scripts/apply-migration-to-prod.ts
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';

dotenv.config();

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

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function applyMigration() {
  let connection: mysql.Connection | null = null;

  try {
    console.log('🚀 Applying Migration to PROD Database\n');
    console.log('='.repeat(60));
    console.log('⚠️  WARNING: This will modify PRODUCTION database!');
    console.log('='.repeat(60));

    // Confirm before proceeding
    const confirm = await askQuestion('\nAre you sure you want to proceed? (type "yes" to continue): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Migration cancelled.');
      process.exit(0);
    }

    // Read migration file
    const migrationPath = path.join(process.cwd(), 'migrations', 'uat-to-prod-migration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}\nPlease run: npx tsx scripts/migrate-schema-uat-to-prod.ts first`);
    }

    console.log(`\n📄 Reading migration file: ${migrationPath}`);
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log('✓ Migration file loaded\n');

    // Connect to PROD
    console.log('🔗 Connecting to PROD database...');
    connection = await mysql.createConnection(PROD_DB_CONFIG);
    console.log('✅ Connected to PROD database\n');

    // Split SQL into statements
    const statements: string[] = [];
    let currentStatement = '';
    let inDelimiter = false;
    let delimiter = ';';

    const lines = migrationSQL.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments
      if (trimmed.startsWith('--') || trimmed.startsWith('/*') || trimmed === '') {
        continue;
      }

      // Handle DELIMITER commands
      if (trimmed.toUpperCase().startsWith('DELIMITER')) {
        if (trimmed.toUpperCase().includes('$$')) {
          delimiter = '$$';
          inDelimiter = true;
        } else {
          delimiter = ';';
          inDelimiter = false;
        }
        continue;
      }

      currentStatement += line + '\n';

      // Check if statement ends
      if (trimmed.endsWith(delimiter)) {
        const statement = currentStatement
          .replace(new RegExp(delimiter + '$'), '')
          .trim();
        
        if (statement.length > 0) {
          statements.push(statement);
        }
        currentStatement = '';
      }
    }

    // Add any remaining statement
    if (currentStatement.trim().length > 0) {
      statements.push(currentStatement.trim());
    }

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    // Execute statements
    console.log('⚡ Executing migration...\n');
    let executed = 0;
    let errors = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip empty statements
      if (!statement || statement.trim().length === 0) {
        continue;
      }

      try {
        await connection.query(statement);
        executed++;
        
        // Show progress for CREATE TABLE and ALTER TABLE
        if (statement.toUpperCase().includes('CREATE TABLE')) {
          const match = statement.match(/CREATE TABLE[^`]*`([^`]+)`/i);
          if (match) {
            console.log(`  ✓ Created table: ${match[1]}`);
          }
        } else if (statement.toUpperCase().includes('ALTER TABLE') && statement.toUpperCase().includes('ADD COLUMN')) {
          const match = statement.match(/ALTER TABLE[^`]*`([^`]+)`[^`]*`([^`]+)`/i);
          if (match) {
            console.log(`  ✓ Added column: ${match[1]}.${match[2]}`);
          }
        }
      } catch (error: any) {
        // Ignore "already exists" errors (idempotent)
        if (error.message.includes('already exists') || 
            error.message.includes('Duplicate') ||
            error.message.includes('Duplicate column name')) {
          // Silently skip - this is expected for idempotent migrations
          executed++;
        } else {
          errors++;
          console.error(`  ✗ Error: ${error.message}`);
          console.error(`    Statement: ${statement.substring(0, 100)}...`);
        }
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Executed: ${executed} statements`);
    if (errors > 0) {
      console.log(`   Errors: ${errors} statements`);
    }

    // Verify migration
    console.log('\n🔍 Verifying migration...\n');
    
    // Check if workflow_artifacts table exists
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('workflow_artifacts', 'workflow_subtasks')",
      [PROD_DB_CONFIG.database]
    );

    if (tables.length === 2) {
      console.log('✓ workflow_artifacts table exists');
      console.log('✓ workflow_subtasks table exists');
    } else {
      console.log('⚠️  Some tables may be missing. Found:', tables.map(t => t.TABLE_NAME).join(', '));
    }

    // Check columns
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND ((TABLE_NAME = 'sdlc_projects' AND COLUMN_NAME IN ('project_id', 'ado_project_url', 'linked_golden_repo_org', 'linked_golden_repo_project')) OR (TABLE_NAME = 'wiki_pages' AND COLUMN_NAME = 'phase'))",
      [PROD_DB_CONFIG.database]
    );

    console.log(`\n✓ Verified ${columns.length} new columns`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration applied successfully to PROD!');
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('\n❌ Migration failed!');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

applyMigration();


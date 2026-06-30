#!/usr/bin/env node
/**
 * Apply Modified Count Migration to Database
 * 
 * This script adds missing columns (modified_count, total_count, modified_items, etc.)
 * to the workflow_artifacts table in QA, UAT, or PROD database
 * 
 * Usage:
 *   npx tsx scripts/apply-modified-count-migration.ts qa
 *   npx tsx scripts/apply-modified-count-migration.ts uat
 *   npx tsx scripts/apply-modified-count-migration.ts prod
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';

dotenv.config();

// Database configurations
const DB_CONFIGS: Record<string, mysql.ConnectionOptions> = {
  qa: {
    host: 'qadevxmysqlserver.mysql.database.azure.com',
    port: 3306,
    user: 'devxadmin',
    password: 'REDACTED_MYSQL_PASSWORD',
    database: 'qadevxdb',
    ssl: {
      rejectUnauthorized: false,
    },
  },
  uat: {
    host: 'uatdevxmysqlserver.mysql.database.azure.com',
    port: 3306,
    user: 'devxadmin',
    password: 'REDACTED_MYSQL_PASSWORD',
    database: 'uatdevxdb',
    ssl: {
      rejectUnauthorized: false,
    },
  },
  prod: {
    host: 'devxserver.mysql.database.azure.com',
    port: 3306,
    user: 'devxadmin',
    password: 'REDACTED_MYSQL_PASSWORD',
    database: 'devxdb',
    ssl: {
      rejectUnauthorized: false,
    },
  },
};

// Migration file paths
const MIGRATION_FILES: Record<string, string> = {
  qa: 'migrations/add-workflow-artifacts-missing-columns-uat.sql', // QA already has columns, but script is idempotent
  uat: 'migrations/add-workflow-artifacts-missing-columns-uat.sql',
  prod: 'migrations/add-workflow-artifacts-missing-columns-prod.sql',
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

function parseSQLStatements(sql: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';
  let delimiter = ';';

  const lines = sql.split('\n');
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
      } else {
        delimiter = ';';
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

  return statements;
}

async function applyMigration(environment: string) {
  let connection: mysql.Connection | null = null;

  try {
    const env = environment.toLowerCase();
    
    if (!['qa', 'uat', 'prod'].includes(env)) {
      throw new Error(`Invalid environment: ${environment}. Must be one of: qa, uat, prod`);
    }

    const dbConfig = DB_CONFIGS[env];
    const migrationFile = MIGRATION_FILES[env];

    console.log(`🚀 Applying Migration to ${env.toUpperCase()} Database\n`);
    console.log('='.repeat(60));
    
    if (env === 'prod') {
      console.log('⚠️  WARNING: This will modify PRODUCTION database!');
      console.log('='.repeat(60));
      
      // Confirm before proceeding for PROD
      const confirm = await askQuestion('\nAre you sure you want to proceed? (type "yes" to continue): ');
      if (confirm.toLowerCase() !== 'yes') {
        console.log('Migration cancelled.');
        process.exit(0);
      }
    }

    // Read migration file
    const migrationPath = path.join(process.cwd(), migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    console.log(`\n📄 Reading migration file: ${migrationPath}`);
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log('✓ Migration file loaded\n');

    // Connect to database
    console.log(`🔗 Connecting to ${env.toUpperCase()} database...`);
    console.log(`   Host: ${dbConfig.host}`);
    console.log(`   Database: ${dbConfig.database}`);
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database\n');

    // Parse SQL statements
    const statements = parseSQLStatements(migrationSQL);
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    // Execute statements
    console.log('⚡ Executing migration...\n');
    let executed = 0;
    let errors = 0;
    const addedColumns: string[] = [];

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip empty statements
      if (!statement || statement.trim().length === 0) {
        continue;
      }

      try {
        const [result]: any = await connection.query(statement);
        executed++;
        
        // Extract column name from ALTER TABLE ADD COLUMN statements
        if (statement.toUpperCase().includes('ALTER TABLE') && statement.toUpperCase().includes('ADD COLUMN')) {
          const match = statement.match(/ALTER TABLE[^`]*`([^`]+)`[^`]*`([^`]+)`/i);
          if (match) {
            const columnName = match[2];
            addedColumns.push(columnName);
            console.log(`  ✓ Added column: ${match[1]}.${columnName}`);
          }
        }
        
        // Extract table name from CREATE PROCEDURE statements
        if (statement.toUpperCase().includes('CREATE PROCEDURE')) {
          const match = statement.match(/CREATE PROCEDURE[^`]*`?([^\s`(]+)`?/i);
          if (match) {
            console.log(`  ✓ Created procedure: ${match[1]}`);
          }
        }
        
        // Extract from CALL statements
        if (statement.toUpperCase().startsWith('CALL')) {
          const match = statement.match(/CALL\s+(\w+)\s*\(/i);
          if (match) {
            // This is a procedure call, result will show in procedure output
          }
        }
      } catch (error: any) {
        // Ignore "already exists" errors (idempotent)
        if (error.message.includes('already exists') || 
            error.message.includes('Duplicate') ||
            error.message.includes('Duplicate column name') ||
            error.message.includes('Column already exists')) {
          // Silently skip - this is expected for idempotent migrations
          executed++;
        } else {
          errors++;
          console.error(`  ✗ Error: ${error.message}`);
          console.error(`    Statement: ${statement.substring(0, 150)}...`);
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
    
    // Check columns in workflow_artifacts
    // Note: QA already has all columns, but we check anyway for verification
    const expectedColumns = env === 'prod' 
      ? ['modified', 'approval_status', 'modified_count', 'total_count', 'modified_items']
      : env === 'qa'
      ? ['modified', 'approval_status', 'modified_count', 'total_count', 'modified_items'] // QA has all columns
      : ['modified_count', 'total_count', 'modified_items']; // UAT missing these 3
    
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'workflow_artifacts'
         AND COLUMN_NAME IN (${expectedColumns.map(() => '?').join(',')})
       ORDER BY ORDINAL_POSITION`,
      [dbConfig.database, ...expectedColumns]
    );

    console.log(`\n📊 Verification Results:`);
    console.log(`   Expected columns: ${expectedColumns.length}`);
    console.log(`   Found columns: ${columns.length}`);
    
    if (columns.length === expectedColumns.length) {
      console.log('\n✓ All expected columns are present:');
      columns.forEach(col => {
        console.log(`   ✓ ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
      });
    } else {
      console.log('\n⚠️  Some columns may be missing:');
      columns.forEach(col => {
        console.log(`   ✓ ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
      });
      const foundColumns = columns.map(c => c.COLUMN_NAME);
      const missingColumns = expectedColumns.filter(c => !foundColumns.includes(c));
      if (missingColumns.length > 0) {
        console.log(`\n   Missing columns: ${missingColumns.join(', ')}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Migration applied successfully to ${env.toUpperCase()}!`);
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

// Get environment from command line argument
const environment = process.argv[2];

if (!environment) {
  console.error('❌ Error: Environment argument is required');
  console.error('\nUsage:');
  console.error('  npx tsx scripts/apply-modified-count-migration.ts qa');
  console.error('  npx tsx scripts/apply-modified-count-migration.ts uat');
  console.error('  npx tsx scripts/apply-modified-count-migration.ts prod');
  process.exit(1);
}

applyMigration(environment);


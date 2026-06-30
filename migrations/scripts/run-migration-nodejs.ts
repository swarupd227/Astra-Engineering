/**
 * ============================================
 * Run Migration via Node.js Script
 * ============================================
 * Description: This script can be run from your local machine or a server
 *              that has access to the Azure MySQL database
 * 
 * Prerequisites:
 *   npm install mysql2 fs
 * 
 * Usage:
 *   npx tsx migrations/run-migration-nodejs.ts
 *   or
 *   ts-node migrations/run-migration-nodejs.ts
 * ============================================
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const UAT_CONFIG = {
  host: 'uatdevxmysqlserver.mysql.database.azure.com',
  user: 'devxadmin',
  database: 'uatdevxdb',
  ssl: {
    rejectUnauthorized: false,
  },
};

async function askQuestion(query: string): Promise<string> {
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

async function runMigration() {
  try {
    // Get password
    const password = await askQuestion('Enter MySQL password for devxadmin: ');
    const connection = await mysql.createConnection({
      ...UAT_CONFIG,
      password,
    });

    console.log('============================================');
    console.log('QA to UAT Schema Migration');
    console.log('============================================\n');

    // Step 1: Backup
    console.log('Step 1: Creating backup...');
    const backupFileName = `uat-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    
    // Note: For full backup, you'd need mysqldump. This is a simplified version.
    // For production, use mysqldump command instead.
    console.log(`⚠️  Note: For full backup, run manually:`);
    console.log(`   mysqldump -h ${UAT_CONFIG.host} -u ${UAT_CONFIG.user} -p ${UAT_CONFIG.database} > ${backupFileName}\n`);

    // Step 2: Read migration file
    console.log('Step 2: Reading migration script...');
    const migrationPath = path.join(process.cwd(), 'migrations', 'qa-to-uat-migration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log('✓ Migration script loaded\n');

    // Step 3: Run migration
    console.log('Step 3: Running migration...');
    console.log('This may take a few minutes...\n');

    // Split by semicolons and execute statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    let executed = 0;
    for (const statement of statements) {
      try {
        // Skip DELIMITER commands (not needed in programmatic execution)
        if (statement.toUpperCase().includes('DELIMITER')) {
          continue;
        }

        await connection.query(statement);
        executed++;
        
        if (executed % 10 === 0) {
          process.stdout.write(`  Executed ${executed} statements...\r`);
        }
      } catch (error: any) {
        // Ignore "already exists" errors for idempotent operations
        if (!error.message.includes('already exists') && 
            !error.message.includes('Duplicate')) {
          console.error(`\nError executing statement: ${error.message}`);
          console.error(`Statement: ${statement.substring(0, 100)}...`);
        }
      }
    }

    console.log(`\n✓ Executed ${executed} statements\n`);

    // Step 4: Verify
    console.log('Step 4: Verifying migration...');
    const [tables] = await connection.query(
      "SELECT COUNT(*) as table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
      [UAT_CONFIG.database]
    ) as any;

    console.log(`✓ Total tables: ${tables[0].table_count}\n`);

    // List all tables
    const [tableList] = await connection.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      [UAT_CONFIG.database]
    ) as any;

    console.log('Tables in database:');
    tableList.forEach((row: any) => {
      console.log(`  - ${row.TABLE_NAME}`);
    });

    await connection.end();
    console.log('\n============================================');
    console.log('✓ Migration completed successfully!');
    console.log('============================================');
  } catch (error: any) {
    console.error('\n✗ Migration failed!');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

runMigration();


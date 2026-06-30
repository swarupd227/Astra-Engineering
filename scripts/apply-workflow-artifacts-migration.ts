import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file if it exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Validate required environment variables
if (!process.env.MYSQL_HOST) {
  throw new Error("MYSQL_HOST environment variable is required. Please set it in your .env file or environment.");
}
if (!process.env.MYSQL_USER) {
  throw new Error("MYSQL_USER environment variable is required. Please set it in your .env file or environment.");
}
if (!process.env.MYSQL_PASSWORD) {
  throw new Error("MYSQL_PASSWORD environment variable is required. Please set it in your .env file or environment.");
}
if (!process.env.MYSQL_DATABASE) {
  throw new Error("MYSQL_DATABASE environment variable is required. Please set it in your .env file or environment.");
}

async function tableExists(connection: mysql.Connection, tableName: string): Promise<boolean> {
  const [tables] = await connection.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [process.env.MYSQL_DATABASE!, tableName]
  );
  return Array.isArray(tables) && tables.length > 0;
}

async function applyMigration() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST!,
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('Connected to Azure MySQL database');
    console.log(`   Host: ${process.env.MYSQL_HOST}`);
    console.log(`   Database: ${process.env.MYSQL_DATABASE}`);
    
    // Start transaction
    await connection.beginTransaction();
    console.log('Starting migration transaction...');

    // Check if tables already exist
    const workflowArtifactsExists = await tableExists(connection, 'workflow_artifacts');
    const workflowSubtasksExists = await tableExists(connection, 'workflow_subtasks');

    if (workflowArtifactsExists && workflowSubtasksExists) {
      console.log('✓ workflow_artifacts table already exists');
      console.log('✓ workflow_subtasks table already exists');
      await connection.commit();
      console.log('\n✅ Tables already exist, no migration needed!');
      return;
    }

    // Read migration SQL file
    const migrationPath = path.join(__dirname, '..', 'migrations', 'manual', 'add-workflow-artifacts-migration.sql');
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    // Split by semicolons and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`\nExecuting ${statements.length} SQL statements...`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          await connection.query(statement);
          console.log(`  ✓ Statement ${i + 1} executed successfully`);
        } catch (error: any) {
          // Ignore "table already exists" errors
          if (error.message && error.message.includes('already exists')) {
            console.log(`  - Statement ${i + 1}: Table already exists (skipping)`);
          } else {
            throw error;
          }
        }
      }
    }

    // Commit transaction
    await connection.commit();
    console.log('\n✅ Migration completed successfully!');

    // Verify the changes
    console.log('\n📊 Verification:');
    const workflowArtifactsExistsAfter = await tableExists(connection, 'workflow_artifacts');
    const workflowSubtasksExistsAfter = await tableExists(connection, 'workflow_subtasks');
    
    console.log(`  workflow_artifacts: ${workflowArtifactsExistsAfter ? '✓' : '✗'}`);
    console.log(`  workflow_subtasks: ${workflowSubtasksExistsAfter ? '✓' : '✗'}`);

  } catch (error) {
    await connection.rollback();
    console.error('\n❌ Migration failed, rolling back:', error);
    throw error;
  } finally {
    await connection.end();
    console.log('\nDatabase connection closed');
  }
}

applyMigration()
  .then(() => {
    console.log('\n✅ All schema changes applied successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });


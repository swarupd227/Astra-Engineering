import dotenv from 'dotenv';
import { execSync } from 'child_process';
dotenv.config();

import mysql from 'mysql2/promise';

// QA Database Configuration
const QA_DB_CONFIG = {
  host: 'qadevxmysqlserver.mysql.database.azure.com',
  port: 3306,
  user: 'devxadmin',
  password: 'REDACTED_MYSQL_PASSWORD',
  database: process.env.QA_MYSQL_DATABASE || 'qadevxdb', // Default database name, can be overridden
  ssl: {
    rejectUnauthorized: false,
  },
};

async function syncQADatabase() {
  console.log('🔄 Starting QA Database Schema Sync...\n');

  // First, check if database exists, create if it doesn't
  const adminConnection = await mysql.createConnection({
    host: QA_DB_CONFIG.host,
    port: QA_DB_CONFIG.port,
    user: QA_DB_CONFIG.user,
    password: QA_DB_CONFIG.password,
    ssl: QA_DB_CONFIG.ssl,
  });

  try {
    console.log('✓ Connected to QA MySQL server');
    
    // Check if database exists
    const [databases] = await adminConnection.query(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [QA_DB_CONFIG.database]
    ) as [any[], any];

    if (Array.isArray(databases) && databases.length === 0) {
      console.log(`📦 Creating database: ${QA_DB_CONFIG.database}`);
      await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${QA_DB_CONFIG.database}\``);
      console.log(`✓ Database created: ${QA_DB_CONFIG.database}`);
    } else {
      console.log(`✓ Database already exists: ${QA_DB_CONFIG.database}`);
    }
  } catch (error) {
    console.error('❌ Error checking/creating database:', error);
    throw error;
  } finally {
    await adminConnection.end();
  }

  // Test the connection to the specific database
  const testConnection = await mysql.createConnection({
    ...QA_DB_CONFIG,
    ssl: QA_DB_CONFIG.ssl,
  });

  try {
    await testConnection.query('SELECT 1');
    console.log(`✓ Successfully connected to QA database: ${QA_DB_CONFIG.database}`);
    console.log(`   Host: ${QA_DB_CONFIG.host}\n`);
  } catch (error) {
    console.error('❌ Error connecting to QA database:', error);
    throw error;
  } finally {
    await testConnection.end();
  }

  // Now use drizzle-kit push to sync the schema
  console.log('📋 Syncing schema from code to QA database using drizzle-kit push...\n');
  
  try {
    // Set environment variables for drizzle-kit
    process.env.MYSQL_HOST = QA_DB_CONFIG.host;
    process.env.MYSQL_PORT = QA_DB_CONFIG.port.toString();
    process.env.MYSQL_USER = QA_DB_CONFIG.user;
    process.env.MYSQL_PASSWORD = QA_DB_CONFIG.password;
    process.env.MYSQL_DATABASE = QA_DB_CONFIG.database;

    console.log('Running: npm run db:push');
    execSync('npm run db:push', {
      stdio: 'inherit',
      env: process.env,
    });

    console.log('\n✅ Schema sync completed successfully!');
  } catch (error) {
    console.error('\n❌ Error running drizzle-kit push:', error);
    console.log('\n📝 Alternative: Run manually with:');
    console.log(`   MYSQL_HOST=${QA_DB_CONFIG.host} \\`);
    console.log(`   MYSQL_PORT=${QA_DB_CONFIG.port} \\`);
    console.log(`   MYSQL_USER=${QA_DB_CONFIG.user} \\`);
    console.log(`   MYSQL_PASSWORD=${QA_DB_CONFIG.password} \\`);
    console.log(`   MYSQL_DATABASE=${QA_DB_CONFIG.database} \\`);
    console.log('   npm run db:push');
    throw error;
  }
}

// Run the sync
syncQADatabase()
  .then(() => {
    console.log('\n✅ QA Database sync process completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ QA Database sync failed:', error);
    process.exit(1);
  });


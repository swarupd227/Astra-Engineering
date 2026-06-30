// Improved migration runner — uses migrations/migration-order.json
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  loadMigrationOrder,
  buildPhasesFromManifest,
  getMysqlConnectionOptions,
  runMigrationPlan,
} from './migration-lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

async function runMigrations() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 MIGRATION RUNNER');
  console.log('='.repeat(80));
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log(`🗄️  Database: ${process.env.MYSQL_DATABASE}`);
  console.log(`🏠 Host: ${process.env.MYSQL_HOST}\n`);

  const strict = process.env.RUN_DB_MIGRATIONS_STRICT === 'true' || process.env.RUN_DB_MIGRATIONS_STRICT === '1';
  const manifest = loadMigrationOrder();
  const phases = buildPhasesFromManifest(manifest);

  let connection;
  try {
    console.log('🔄 Connecting to database...');
    connection = await mysql.createConnection({
      ...getMysqlConnectionOptions(),
      multipleStatements: true,
    });
    console.log('✅ Connected to database\n');

    const { runner, successCount, skippedCount, failedCount, totalFiles } = await runMigrationPlan({
      phases,
      connection,
      strict,
    });

    console.log('\n' + '='.repeat(80));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Successful: ${successCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log(`❌ Failed: ${failedCount}`);
    console.log(`📦 Total files: ${totalFiles}`);
    console.log('='.repeat(80) + '\n');

    await runner.showMigrationHistory();

    if (failedCount > 0 && strict) {
      process.exit(1);
    }

    console.log('✅ Migration process completed!\n');
  } catch (error) {
    console.error('\n❌ Fatal error during migration:');
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed\n');
    }
  }
}

runMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

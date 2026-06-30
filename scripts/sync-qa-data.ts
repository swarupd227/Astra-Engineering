import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../shared/schema-mysql';
import { sql } from 'drizzle-orm';

// Production Database Configuration (from environment variables)
const PROD_DB_CONFIG = {
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: {
    rejectUnauthorized: false,
  },
};

// QA Database Configuration
const QA_DB_CONFIG = {
  host: 'qadevxmysqlserver.mysql.database.azure.com',
  port: 3306,
  user: 'devxadmin',
  password: 'REDACTED_MYSQL_PASSWORD',
  database: process.env.QA_MYSQL_DATABASE || 'qadevxdb',
  ssl: {
    rejectUnauthorized: false,
  },
};

// Map schema exports to their database table names and define order
// Order matters for foreign key constraints
const TABLE_MAP: Array<{ exportName: string; tableName: string }> = [
  { exportName: 'users', tableName: 'users' },
  { exportName: 'organizations', tableName: 'organizations' },
  { exportName: 'projects', tableName: 'projects' },
  { exportName: 'goldenRepositories', tableName: 'golden_repositories' },
  { exportName: 'adoSettings', tableName: 'ado_settings' },
  { exportName: 'artifactOrganizations', tableName: 'artifact_organizations' },
  { exportName: 'goldenRepoOrganizations', tableName: 'golden_repo_organizations' },
  { exportName: 'conversationalUiSettings', tableName: 'conversational_ui_settings' },
  { exportName: 'workflowSettings', tableName: 'workflow_settings' },
  { exportName: 'sdlcSettings', tableName: 'sdlc_settings' },
  { exportName: 'personas', tableName: 'personas' },
  { exportName: 'wikiPages', tableName: 'wiki_pages' },
  { exportName: 'sdlcProjects', tableName: 'sdlc_projects' },
  { exportName: 'sdlcPhases', tableName: 'sdlc_phases' },
  { exportName: 'phaseConfirmations', tableName: 'phase_confirmations' },
  { exportName: 'developmentRepositories', tableName: 'development_repositories' },
  { exportName: 'developmentBranches', tableName: 'development_branches' },
  { exportName: 'sdlcIssues', tableName: 'sdlc_issues' },
  { exportName: 'sdlcEpics', tableName: 'sdlc_epics' },
  { exportName: 'sdlcRequirements', tableName: 'sdlc_requirements' },
  { exportName: 'sdlcBacklogItems', tableName: 'sdlc_backlog_items' },
  { exportName: 'sdlcDocuments', tableName: 'sdlc_documents' },
  { exportName: 'sdlcDesignAssets', tableName: 'sdlc_design_assets' },
  { exportName: 'adoDesignSync', tableName: 'ado_design_sync' },
  { exportName: 'sdlcFigmaLinks', tableName: 'sdlc_figma_links' },
  { exportName: 'sdlcDesignReviews', tableName: 'sdlc_design_reviews' },
  { exportName: 'sdlcCode', tableName: 'sdlc_code' },
  { exportName: 'sdlcCommits', tableName: 'sdlc_commits' },
  { exportName: 'sdlcPreviews', tableName: 'sdlc_previews' },
];

// Get all table objects from schema
function getTableObjects() {
  const tables: Array<{ name: string; table: any }> = [];
  
  for (const { exportName, tableName } of TABLE_MAP) {
    const table = (schema as any)[exportName];
    if (table) {
      tables.push({ name: tableName, table });
    } else {
      console.warn(`⚠️  Table export "${exportName}" not found in schema`);
    }
  }
  
  return tables;
}

async function syncTableData(
  prodDb: any,
  qaDb: any,
  tableName: string,
  table: any,
  truncateFirst: boolean = false
) {
  try {
    console.log(`\n📦 Syncing table: ${tableName}`);
    
    // Get row count from production
    const prodRows = await prodDb.select().from(table);
    const rowCount = Array.isArray(prodRows) ? prodRows.length : 0;
    
    if (rowCount === 0) {
      console.log(`   ⚠️  No data in production, skipping...`);
      return { synced: 0, skipped: true };
    }
    
    console.log(`   📊 Found ${rowCount} rows in production`);
    
    // Truncate QA table if requested
    if (truncateFirst) {
      console.log(`   🗑️  Truncating QA table...`);
      await qaDb.execute(sql.raw(`SET FOREIGN_KEY_CHECKS=0;`));
      await qaDb.execute(sql.raw(`TRUNCATE TABLE \`${tableName}\`;`));
      await qaDb.execute(sql.raw(`SET FOREIGN_KEY_CHECKS=1;`));
    }
    
    // Check if QA table has existing data
    const qaRows = await qaDb.select().from(table);
    const qaRowCount = Array.isArray(qaRows) ? qaRows.length : 0;
    
    if (qaRowCount > 0 && !truncateFirst) {
      console.log(`   ⚠️  QA table already has ${qaRowCount} rows. Use --truncate to replace.`);
      return { synced: 0, skipped: true };
    }
    
    // Insert data in batches for better performance
    const batchSize = 100;
    let synced = 0;
    
    // Disable foreign key checks temporarily for faster inserts
    await qaDb.execute(sql.raw(`SET FOREIGN_KEY_CHECKS=0;`));
    
    try {
      for (let i = 0; i < prodRows.length; i += batchSize) {
        const batch = prodRows.slice(i, i + batchSize);
        
        try {
          // Insert batch
          if (batch.length > 0) {
            await qaDb.insert(table).values(batch as any[]);
            synced += batch.length;
            process.stdout.write(`   ⏳ Synced ${synced}/${rowCount} rows...\r`);
          }
        } catch (error: any) {
          // Handle duplicate key errors gracefully
          if (error.code === 'ER_DUP_ENTRY') {
            console.log(`\n   ⚠️  Duplicate entry detected in batch, inserting one by one...`);
            // Try inserting one by one to identify conflicts
            for (const row of batch) {
              try {
                await qaDb.insert(table).values(row as any);
                synced++;
              } catch (err: any) {
                if (err.code !== 'ER_DUP_ENTRY') {
                  console.error(`\n   ❌ Error inserting row:`, err.message);
                  throw err;
                }
                // Skip duplicate entries
              }
            }
          } else {
            throw error;
          }
        }
      }
    } finally {
      // Re-enable foreign key checks
      await qaDb.execute(sql.raw(`SET FOREIGN_KEY_CHECKS=1;`));
    }
    
    console.log(`\n   ✅ Synced ${synced} rows to QA`);
    return { synced, skipped: false };
  } catch (error: any) {
    console.error(`\n   ❌ Error syncing ${tableName}:`, error.message);
    throw error;
  }
}

async function syncDataFromProdToQA(truncateFirst: boolean = false) {
  console.log('🔄 Starting Data Sync from Production to QA...\n');
  
  // Validate production database config
  if (!PROD_DB_CONFIG.host || !PROD_DB_CONFIG.user || !PROD_DB_CONFIG.password || !PROD_DB_CONFIG.database) {
    throw new Error('Production database configuration is missing. Please set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE environment variables.');
  }
  
  // Create connections
  const prodPool = mysql.createPool({
    ...PROD_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  
  const qaPool = mysql.createPool({
    ...QA_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  
  const prodDb = drizzle(prodPool, { schema, mode: 'default' });
  const qaDb = drizzle(qaPool, { schema, mode: 'default' });
  
  try {
    // Test connections
    console.log('🔗 Testing connections...');
    await prodPool.getConnection().then(conn => {
      console.log(`✓ Connected to Production: ${PROD_DB_CONFIG.host}/${PROD_DB_CONFIG.database}`);
      conn.release();
    });
    
    await qaPool.getConnection().then(conn => {
      console.log(`✓ Connected to QA: ${QA_DB_CONFIG.host}/${QA_DB_CONFIG.database}`);
      conn.release();
    });
    
    // Get all tables
    const tables = getTableObjects();
    console.log(`\n📋 Found ${tables.length} tables to sync\n`);
    
    if (truncateFirst) {
      console.log('⚠️  WARNING: Truncate mode enabled. All existing QA data will be deleted!\n');
    }
    
    // Sync each table
    const results: Array<{ table: string; synced: number; skipped: boolean }> = [];
    
    for (const { name, table } of tables) {
      try {
        const result = await syncTableData(prodDb, qaDb, name, table, truncateFirst);
        results.push({ table: name, synced: result.synced, skipped: result.skipped });
      } catch (error: any) {
        console.error(`\n❌ Failed to sync ${name}:`, error.message);
        results.push({ table: name, synced: 0, skipped: false });
        // Continue with other tables
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Sync Summary');
    console.log('='.repeat(60));
    
    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    const totalSkipped = results.filter(r => r.skipped).length;
    const totalFailed = results.filter(r => !r.skipped && r.synced === 0).length;
    
    console.log(`✅ Successfully synced: ${totalSynced} total rows`);
    console.log(`⏭️  Skipped (no data or already exists): ${totalSkipped} tables`);
    if (totalFailed > 0) {
      console.log(`❌ Failed: ${totalFailed} tables`);
    }
    
    console.log('\n📋 Table Details:');
    results.forEach(r => {
      if (r.synced > 0) {
        console.log(`   ✅ ${r.table}: ${r.synced} rows`);
      } else if (r.skipped) {
        console.log(`   ⏭️  ${r.table}: skipped`);
      } else {
        console.log(`   ❌ ${r.table}: failed`);
      }
    });
    
    console.log('\n✅ Data sync completed!');
    
  } catch (error) {
    console.error('\n❌ Data sync failed:', error);
    throw error;
  } finally {
    await prodPool.end();
    await qaPool.end();
    console.log('\n🔌 Database connections closed');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const truncateFirst = args.includes('--truncate') || args.includes('-t');

// Run the sync
syncDataFromProdToQA(truncateFirst)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Data sync failed:', error);
    process.exit(1);
  });


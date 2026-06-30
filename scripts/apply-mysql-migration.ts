import mysql from 'mysql2/promise';

async function columnExists(connection: mysql.Connection, tableName: string, columnName: string): Promise<boolean> {
  const [columns] = await connection.query(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName]
  );
  return Array.isArray(columns) && columns.length > 0;
}

async function applyMigration() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    ssl: {
      rejectUnauthorized: true
    }
  });

  try {
    console.log('Connected to Azure MySQL database');
    
    // Start transaction
    await connection.beginTransaction();
    console.log('Starting migration transaction...');

    // 1. Add columns to workflow_settings
    console.log('\n1. Updating workflow_settings table...');
    const workflowColumns = ['repositoryName', 'projectName', 'organizationUrl', 'patToken'];
    for (const col of workflowColumns) {
      if (!(await columnExists(connection, 'workflow_settings', col))) {
        const dataType = col === 'patToken' ? 'TEXT' : 'VARCHAR(255)';
        await connection.query(`ALTER TABLE workflow_settings ADD COLUMN ${col} ${dataType}`);
        console.log(`  ✓ Added column: ${col}`);
      } else {
        console.log(`  - Column already exists: ${col}`);
      }
    }

    // 2. Add columns to conversational_ui_settings
    console.log('\n2. Updating conversational_ui_settings table...');
    const conversationalColumns = ['repositoryName', 'projectName', 'organizationUrl', 'patToken'];
    for (const col of conversationalColumns) {
      if (!(await columnExists(connection, 'conversational_ui_settings', col))) {
        const dataType = col === 'patToken' ? 'TEXT' : 'VARCHAR(255)';
        await connection.query(`ALTER TABLE conversational_ui_settings ADD COLUMN ${col} ${dataType}`);
        console.log(`  ✓ Added column: ${col}`);
      } else {
        console.log(`  - Column already exists: ${col}`);
      }
    }

    // 3. Rename column in artifact_organizations
    console.log('\n3. Updating artifact_organizations table...');
    const hasProjectName = await columnExists(connection, 'artifact_organizations', 'projectName');
    const hasName = await columnExists(connection, 'artifact_organizations', 'name');
    
    if (hasName && !hasProjectName) {
      // Rename from 'name' to 'projectName'
      await connection.query(`
        ALTER TABLE artifact_organizations 
        CHANGE COLUMN name projectName VARCHAR(255) NOT NULL
      `);
      console.log('  ✓ Renamed column: name → projectName');
    } else if (hasProjectName) {
      console.log('  - Column already renamed: projectName exists');
    } else {
      console.log('  ! Warning: Neither name nor projectName column found');
    }

    // Commit transaction
    await connection.commit();
    console.log('\n✅ Migration completed successfully!');

    // Verify the changes
    console.log('\n📊 Verification:');
    
    const [workflowCols] = await connection.query(`
      SHOW COLUMNS FROM workflow_settings WHERE Field IN ('repositoryName', 'projectName', 'organizationUrl', 'patToken')
    `);
    console.log(`  workflow_settings: ${Array.isArray(workflowCols) ? workflowCols.length : 0}/4 new columns`);

    const [conversationalCols] = await connection.query(`
      SHOW COLUMNS FROM conversational_ui_settings WHERE Field IN ('repositoryName', 'projectName', 'organizationUrl', 'patToken')
    `);
    console.log(`  conversational_ui_settings: ${Array.isArray(conversationalCols) ? conversationalCols.length : 0}/4 new columns`);

    const [artifactCols] = await connection.query(`
      SHOW COLUMNS FROM artifact_organizations WHERE Field = 'projectName'
    `);
    console.log(`  artifact_organizations: projectName ${Array.isArray(artifactCols) && artifactCols.length > 0 ? '✓' : '✗'}`);

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

import mysql from 'mysql2/promise';

async function columnExists(connection: mysql.Connection, tableName: string, columnName: string): Promise<boolean> {
  const [columns] = await connection.query(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName]
  );
  return Array.isArray(columns) && columns.length > 0;
}

async function dropTimestampColumns() {
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

    // 1. Drop columns from workflow_settings
    console.log('\n1. Updating workflow_settings table...');
    const workflowTimestampCols = ['created_at', 'updated_at'];
    for (const col of workflowTimestampCols) {
      if (await columnExists(connection, 'workflow_settings', col)) {
        await connection.query(`ALTER TABLE workflow_settings DROP COLUMN ${col}`);
        console.log(`  ✓ Dropped column: ${col}`);
      } else {
        console.log(`  - Column already removed: ${col}`);
      }
    }

    // 2. Drop columns from conversational_ui_settings
    console.log('\n2. Updating conversational_ui_settings table...');
    const conversationalTimestampCols = ['created_at', 'updated_at'];
    for (const col of conversationalTimestampCols) {
      if (await columnExists(connection, 'conversational_ui_settings', col)) {
        await connection.query(`ALTER TABLE conversational_ui_settings DROP COLUMN ${col}`);
        console.log(`  ✓ Dropped column: ${col}`);
      } else {
        console.log(`  - Column already removed: ${col}`);
      }
    }

    // Commit transaction
    await connection.commit();
    console.log('\n✅ Migration completed successfully!');

    // Verify the changes
    console.log('\n📊 Verification:');
    
    const [workflowCols] = await connection.query(`SHOW COLUMNS FROM workflow_settings`);
    console.log(`  workflow_settings columns: ${Array.isArray(workflowCols) ? workflowCols.map((c: any) => c.Field).join(', ') : 'none'}`);

    const [conversationalCols] = await connection.query(`SHOW COLUMNS FROM conversational_ui_settings`);
    console.log(`  conversational_ui_settings columns: ${Array.isArray(conversationalCols) ? conversationalCols.map((c: any) => c.Field).join(', ') : 'none'}`);

  } catch (error) {
    await connection.rollback();
    console.error('\n❌ Migration failed, rolling back:', error);
    throw error;
  } finally {
    await connection.end();
    console.log('\nDatabase connection closed');
  }
}

dropTimestampColumns()
  .then(() => {
    console.log('\n✅ Timestamp columns dropped successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });

import mysql from 'mysql2/promise';

async function columnExists(connection: mysql.Connection, tableName: string, columnName: string): Promise<boolean> {
  const [columns] = await connection.query(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName]
  );
  return Array.isArray(columns) && columns.length > 0;
}

async function cleanupSettingsColumns() {
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
    console.log('Starting cleanup migration...');

    // Define columns to keep
    const keepColumns = ['id', 'repositoryName', 'projectName', 'organizationUrl', 'patToken'];

    // 1. Clean up workflow_settings
    console.log('\n1. Cleaning workflow_settings table...');
    const [workflowCols] = await connection.query(`SHOW COLUMNS FROM workflow_settings`);
    if (Array.isArray(workflowCols)) {
      for (const col of workflowCols) {
        const colName = (col as any).Field;
        if (!keepColumns.includes(colName)) {
          await connection.query(`ALTER TABLE workflow_settings DROP COLUMN ${colName}`);
          console.log(`  ✓ Dropped column: ${colName}`);
        }
      }
    }

    // 2. Clean up conversational_ui_settings
    console.log('\n2. Cleaning conversational_ui_settings table...');
    const [conversationalCols] = await connection.query(`SHOW COLUMNS FROM conversational_ui_settings`);
    if (Array.isArray(conversationalCols)) {
      for (const col of conversationalCols) {
        const colName = (col as any).Field;
        if (!keepColumns.includes(colName)) {
          await connection.query(`ALTER TABLE conversational_ui_settings DROP COLUMN ${colName}`);
          console.log(`  ✓ Dropped column: ${colName}`);
        }
      }
    }

    // Commit transaction
    await connection.commit();
    console.log('\n✅ Cleanup completed successfully!');

    // Verify the changes
    console.log('\n📊 Final column structure:');
    
    const [finalWorkflowCols] = await connection.query(`SHOW COLUMNS FROM workflow_settings`);
    console.log(`  workflow_settings: ${Array.isArray(finalWorkflowCols) ? finalWorkflowCols.map((c: any) => c.Field).join(', ') : 'none'}`);

    const [finalConversationalCols] = await connection.query(`SHOW COLUMNS FROM conversational_ui_settings`);
    console.log(`  conversational_ui_settings: ${Array.isArray(finalConversationalCols) ? finalConversationalCols.map((c: any) => c.Field).join(', ') : 'none'}`);

  } catch (error) {
    await connection.rollback();
    console.error('\n❌ Cleanup failed, rolling back:', error);
    throw error;
  } finally {
    await connection.end();
    console.log('\nDatabase connection closed');
  }
}

cleanupSettingsColumns()
  .then(() => {
    console.log('\n✅ Settings tables cleaned up successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Cleanup script failed:', error);
    process.exit(1);
  });

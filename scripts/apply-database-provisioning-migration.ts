import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

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
    ssl: { rejectUnauthorized: true },
  });

  try {
    console.log('Connected to MySQL database');
    await connection.beginTransaction();

    console.log('\nUpdating provisioning_instances table...');

    // Make runtime and plan_tier nullable (they were NOT NULL before)
    const [runtimeCol]: any = await connection.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provisioning_instances' AND COLUMN_NAME = 'runtime'`
    );
    if (runtimeCol.length > 0 && runtimeCol[0].IS_NULLABLE === 'NO') {
      await connection.query(`ALTER TABLE provisioning_instances MODIFY COLUMN runtime VARCHAR(100) NULL`);
      console.log('  ✓ Made runtime nullable');
    } else {
      console.log('  - runtime already nullable');
    }

    const [planTierCol]: any = await connection.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provisioning_instances' AND COLUMN_NAME = 'plan_tier'`
    );
    if (planTierCol.length > 0 && planTierCol[0].IS_NULLABLE === 'NO') {
      await connection.query(`ALTER TABLE provisioning_instances MODIFY COLUMN plan_tier VARCHAR(100) NULL`);
      console.log('  ✓ Made plan_tier nullable');
    } else {
      console.log('  - plan_tier already nullable');
    }

    // Add database-specific columns
    if (!(await columnExists(connection, 'provisioning_instances', 'database_engine'))) {
      await connection.query(`ALTER TABLE provisioning_instances ADD COLUMN database_engine VARCHAR(50) NULL AFTER url`);
      console.log('  ✓ Added column: database_engine');
    } else {
      console.log('  - database_engine already exists');
    }

    if (!(await columnExists(connection, 'provisioning_instances', 'database_server_name'))) {
      await connection.query(`ALTER TABLE provisioning_instances ADD COLUMN database_server_name VARCHAR(255) NULL AFTER database_engine`);
      console.log('  ✓ Added column: database_server_name');
    } else {
      console.log('  - database_server_name already exists');
    }

    if (!(await columnExists(connection, 'provisioning_instances', 'database_name'))) {
      await connection.query(`ALTER TABLE provisioning_instances ADD COLUMN database_name VARCHAR(255) NULL AFTER database_server_name`);
      console.log('  ✓ Added column: database_name');
    } else {
      console.log('  - database_name already exists');
    }

    await connection.commit();
    console.log('\n✅ Migration completed successfully');
  } catch (error) {
    await connection.rollback();
    console.error('❌ Migration failed, rolling back:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

applyMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});

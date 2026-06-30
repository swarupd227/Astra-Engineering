import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function createProvisioningInstancesTable() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('🔄 Creating provisioning_instances table...');

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS \`provisioning_instances\` (
        \`id\` varchar(36) NOT NULL PRIMARY KEY,
        \`instance_name\` varchar(255) NOT NULL,
        \`status\` enum('provisioning', 'ready', 'failed', 'deleting', 'deleted') NOT NULL DEFAULT 'provisioning',
        \`environment\` varchar(50) NOT NULL,
        \`region\` varchar(50) NOT NULL,
        \`runtime\` varchar(100) NOT NULL,
        \`plan_tier\` varchar(100) NOT NULL,
        \`subscription_id\` varchar(36),
        \`resource_group_name\` varchar(255),
        \`app_service_name\` varchar(255),
        \`app_service_plan_name\` varchar(255),
        \`url\` varchar(500),
        \`enable_logging\` boolean DEFAULT false,
        \`auto_delete_days\` int,
        \`tags\` json,
        \`error_message\` text,
        \`provisioning_started_at\` timestamp,
        \`provisioning_completed_at\` timestamp,
        \`user_id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36),
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `;

    await connection.execute(createTableSQL);
    console.log('✅ Table provisioning_instances completed');

    // Add indexes for better query performance
    const indexes = [
      'CREATE INDEX `idx_provisioning_instances_user_id` ON `provisioning_instances` (`user_id`);',
      'CREATE INDEX `idx_provisioning_instances_status` ON `provisioning_instances` (`status`);',
      'CREATE INDEX `idx_provisioning_instances_instance_name` ON `provisioning_instances` (`instance_name`);'
    ];

    for (const indexSQL of indexes) {
      try {
        await connection.execute(indexSQL);
        console.log(`✅ Index created: ${indexSQL.split(' ')[2]}`);
      } catch (error) {
        // Ignore duplicate key errors for existing indexes
        if (error.code !== 'ER_DUP_KEYNAME') {
          console.warn(`⚠️ Warning creating index: ${error.message}`);
        }
      }
    }

    console.log('✅ Indexes created successfully');
    console.log('🎉 provisioning_instances table setup complete!');

  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

createProvisioningInstancesTable().catch(console.error);

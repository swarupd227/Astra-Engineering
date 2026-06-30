import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('=== Database Cleanup - MySQL ===');

try {
  // Create MySQL connection
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
      ca: process.env.DB_SSL_CA
    }
  });

  // Get all instances from the database
  const [instances] = await connection.execute('SELECT * FROM provisioning_instances ORDER BY created_at DESC');

  console.log(`Found ${instances.length} instances in database:`);
  instances.forEach((instance) => {
    console.log(`- ${instance.id}: ${instance.instance_name} (${instance.status}) - ${instance.created_at}`);
  });

  // Get failed instances
  const [failedInstances] = await connection.execute('SELECT * FROM provisioning_instances WHERE status = ?', ['failed']);
  console.log(`\nFailed instances: ${failedInstances.length}`);

  // Get successful instances
  const [successfulInstances] = await connection.execute('SELECT * FROM provisioning_instances WHERE status = ?', ['succeeded']);
  console.log(`Successful instances: ${successfulInstances.length}`);

  // Get pending instances
  const [pendingInstances] = await connection.execute('SELECT * FROM provisioning_instances WHERE status = ?', ['pending']);
  console.log(`Pending instances: ${pendingInstances.length}`);

  console.log('\n=== Cleanup Options ===');
  console.log('To delete all failed instances, run:');
  console.log('DELETE FROM provisioning_instances WHERE status = \'failed\';');

  console.log('\nTo delete specific instance by ID, run:');
  console.log('DELETE FROM provisioning_instances WHERE id = \'instance-id-here\';');

  console.log('\nTo mark pending instances as failed, run:');
  console.log('UPDATE provisioning_instances SET status = \'failed\' WHERE status = \'pending\';');

  await connection.end();

} catch (error) {
  console.error('Database error:', error);
}

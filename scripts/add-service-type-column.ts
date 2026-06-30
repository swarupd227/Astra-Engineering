import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function addServiceTypeColumn() {
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
    console.log('🔄 Adding service_type column to provisioning_instances table...');

    const addColumnSQL = `
      ALTER TABLE \`provisioning_instances\` 
      ADD COLUMN \`service_type\` varchar(50) NOT NULL DEFAULT 'Web App' 
      AFTER \`region\`;
    `;

    await connection.execute(addColumnSQL);
    console.log('✅ service_type column added successfully');
    console.log('🎉 Database schema update complete!');

  } catch (error) {
    // Ignore column already exists errors
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('✅ service_type column already exists');
    } else {
      console.error('❌ Error adding column:', error);
      throw error;
    }
  } finally {
    await connection.end();
  }
}

addServiceTypeColumn().catch(console.error);

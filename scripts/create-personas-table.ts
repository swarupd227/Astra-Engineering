import dotenv from 'dotenv';
dotenv.config();

import mysql from "mysql2/promise";

async function createPersonasTable() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log("Creating personas table...");
    
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS personas (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        color TEXT NOT NULL,
        focus TEXT NOT NULL,
        pain_points JSON NOT NULL,
        goals JSON NOT NULL,
        is_default INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;
    
    await connection.execute(createTableSQL);
    console.log("✓ Personas table created successfully");
    
    // Check if table exists
    const [rows] = await connection.query("SHOW TABLES LIKE 'personas'");
    console.log("Table exists:", (rows as any[]).length > 0);
    
    // Check table structure
    const [columns] = await connection.query("DESCRIBE personas");
    console.log("\nTable structure:");
    console.table(columns);
    
  } catch (error) {
    console.error("Error creating table:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

createPersonasTable()
  .then(() => {
    console.log("\n✓ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Script failed:", error);
    process.exit(1);
  });

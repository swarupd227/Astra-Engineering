import { config } from "dotenv";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

// Load environment variables
config();

async function applyMigration() {
  console.log("🔄 Starting migration: Add requirement_ids column to workflow_artifacts");
  
  const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true, // Allow multiple SQL statements
  };

  console.log("📊 Database Config:", {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
  });

  let connection: mysql.Connection | null = null;

  try {
    // Create connection
    connection = await mysql.createConnection(dbConfig);
    console.log("✅ Connected to database");

    // Check if column already exists
    const [columns] = await connection.query(
      `SELECT COUNT(*) as count 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? 
         AND TABLE_NAME = 'workflow_artifacts' 
         AND COLUMN_NAME = 'requirement_ids'`,
      [dbConfig.database]
    );

    const columnExists = (columns as any)[0].count > 0;

    if (columnExists) {
      console.log("ℹ️  Column 'requirement_ids' already exists in workflow_artifacts table");
      return;
    }

    console.log("➕ Adding requirement_ids column...");

    // Add the column
    await connection.query(
      `ALTER TABLE workflow_artifacts ADD COLUMN requirement_ids JSON AFTER brd_id`
    );

    console.log("✅ Column added successfully");

    // Set default value for existing rows
    console.log("🔄 Setting default values for existing rows...");
    await connection.query(
      `UPDATE workflow_artifacts SET requirement_ids = JSON_ARRAY() WHERE requirement_ids IS NULL`
    );

    console.log("✅ Default values set");

    // Verify the column was added
    const [verification] = await connection.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'workflow_artifacts'
         AND COLUMN_NAME = 'requirement_ids'`,
      [dbConfig.database]
    );

    console.log("✅ Column verification:", verification);
    console.log("🎉 Migration completed successfully!");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log("🔌 Database connection closed");
    }
  }
}

// Run migration
applyMigration()
  .then(() => {
    console.log("✨ All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });

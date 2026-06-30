// Run the design guidelines table migration
import mysql from "mysql2/promise";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// Load environment variables from .env file
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate environment variables
const requiredEnvVars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error("Please make sure all MySQL environment variables are set in .env file");
    process.exit(1);
  }
}

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST!,
  port: parseInt(process.env.MYSQL_PORT || "3306"),
  user: process.env.MYSQL_USER!,
  password: process.env.MYSQL_PASSWORD!,
  database: process.env.MYSQL_DATABASE!,
  ssl: {
    rejectUnauthorized: false,
  },
};

async function runMigration() {
  console.log("🚀 Running design guidelines table migration...");
  
  try {
    // Create connection
    const connection = await mysql.createConnection(MYSQL_CONFIG);
    
    console.log("✅ Connected to MySQL database");
    
    // Read migration file
    const migrationPath = path.join(__dirname, 'add-design-guidelines-table.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
    
    console.log("📄 Read migration SQL file");
    
    // Execute migration (split by semicolon to handle multiple statements)
    const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.execute(statement.trim());
      }
    }
    
    console.log("✅ Successfully created design_guidelines table");
    
    await connection.end();
    
    console.log("🎉 Migration completed successfully!");
    
  } catch (error) {
    console.error("❌ Migration failed:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    process.exit(1);
  }
}

// Run the migration
runMigration();
import mysql from "mysql2/promise";
import * as fs from "fs";
import * as path from "path";

async function createDevBrdTable() {
  // Validate required environment variables
  if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD || !process.env.MYSQL_DATABASE) {
    console.error("Error: Missing required MySQL environment variables:");
    console.error("  - MYSQL_HOST");
    console.error("  - MYSQL_USER");
    console.error("  - MYSQL_PASSWORD");
    console.error("  - MYSQL_DATABASE");
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log("Connected to MySQL database");
    console.log(`Database: ${process.env.MYSQL_DATABASE}`);

    // Check if table exists
    const [tables] = await connection.query(
      `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dev_brd_documents'`,
      [process.env.MYSQL_DATABASE]
    ) as any;

    if (tables[0].count > 0) {
      console.log("✓ Table 'dev_brd_documents' already exists, skipping creation.");
      await connection.end();
      return;
    }

    // Read and execute migration SQL
    const migrationPath = path.join(__dirname, "../migrations/create-dev-brd-documents-table-simple.sql");
    const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

    console.log("\nCreating table 'dev_brd_documents'...");
    await connection.query(migrationSQL);

    console.log("✓ Successfully created table 'dev_brd_documents'");

    // Verify table was created
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dev_brd_documents'
       ORDER BY ORDINAL_POSITION`,
      [process.env.MYSQL_DATABASE]
    ) as any;

    console.log("\nTable structure:");
    console.table(columns);

  } catch (error) {
    console.error("Error creating table:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

createDevBrdTable()
  .then(() => {
    console.log("\n✓ Migration completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });




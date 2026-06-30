import mysql from "mysql2/promise";
import * as fs from "fs";
import * as path from "path";

async function addBrdFileColumns() {
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

    if (tables[0].count === 0) {
      console.error("Error: Table 'dev_brd_documents' does not exist. Please create it first.");
      await connection.end();
      process.exit(1);
    }

    console.log("✓ Table 'dev_brd_documents' exists.");

    // Check which columns already exist
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dev_brd_documents'`,
      [process.env.MYSQL_DATABASE]
    ) as any;

    const existingColumns = new Set(columns.map((col: any) => col.COLUMN_NAME));

    console.log("\nExisting columns:", Array.from(existingColumns).join(", "));

    // Migration 1: Add file columns
    const fileColumnsMigration = path.join(__dirname, "../migrations/add-brd-file-columns.sql");
    const fileColumnsSQL = fs.readFileSync(fileColumnsMigration, "utf-8");

    const fileColumnsNeeded = ['brd_file', 'brd_file_name', 'brd_file_type', 'brd_file_size'];
    const fileColumnsMissing = fileColumnsNeeded.filter(col => !existingColumns.has(col));

    if (fileColumnsMissing.length > 0) {
      console.log(`\nAdding file columns: ${fileColumnsMissing.join(", ")}...`);
      try {
        await connection.query(fileColumnsSQL);
        console.log("✓ Successfully added file columns");
      } catch (error: any) {
        if (error.message.includes("Duplicate column name")) {
          console.log("✓ File columns already exist (some may have been added previously)");
        } else {
          throw error;
        }
      }
    } else {
      console.log("✓ All file columns already exist");
    }

    // Re-check columns after first migration (in case they were just added)
    const [columnsAfterFirst] = await connection.query(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dev_brd_documents'`,
      [process.env.MYSQL_DATABASE]
    ) as any;
    const existingColumnsAfterFirst = new Set(columnsAfterFirst.map((col: any) => col.COLUMN_NAME));

    // Migration 2: Add generated content columns
    const contentColumnsNeeded = ['generated_markdown', 'generated_brd_json'];
    const contentColumnsMissing = contentColumnsNeeded.filter(col => !existingColumnsAfterFirst.has(col));

    if (contentColumnsMissing.length > 0) {
      console.log(`\nAdding generated content columns: ${contentColumnsMissing.join(", ")}...`);
      
      // Add columns one by one to handle partial failures gracefully
      for (const column of contentColumnsMissing) {
        try {
          if (column === 'generated_markdown') {
            await connection.query(
              `ALTER TABLE dev_brd_documents ADD COLUMN generated_markdown LONGTEXT NULL`
            );
            console.log(`  ✓ Added column: generated_markdown`);
          } else if (column === 'generated_brd_json') {
            await connection.query(
              `ALTER TABLE dev_brd_documents ADD COLUMN generated_brd_json JSON NULL`
            );
            console.log(`  ✓ Added column: generated_brd_json`);
          }
        } catch (error: any) {
          if (error.message.includes("Duplicate column name")) {
            console.log(`  ✓ Column ${column} already exists`);
          } else {
            console.error(`  ✗ Failed to add column ${column}:`, error.message);
            throw error;
          }
        }
      }
      console.log("✓ Successfully added generated content columns");
    } else {
      console.log("✓ All generated content columns already exist");
    }

    // Verify final structure
    const [finalColumns] = await connection.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'dev_brd_documents'
       ORDER BY ORDINAL_POSITION`,
      [process.env.MYSQL_DATABASE]
    ) as any;

    console.log("\nFinal table structure:");
    console.table(finalColumns);

    console.log("\n✓ Migration completed successfully!");

  } catch (error) {
    console.error("\n✗ Migration failed:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

addBrdFileColumns()
  .then(() => {
    console.log("\n✓ All migrations applied successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });


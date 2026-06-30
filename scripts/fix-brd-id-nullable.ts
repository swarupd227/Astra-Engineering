/**
 * Script to fix brd_id column to allow NULL values
 * This ensures the column matches the schema definition
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function checkAndFixBrdIdColumn() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    ssl:
      process.env.MYSQL_HOST?.includes("azure.com") ||
      process.env.MYSQL_HOST?.includes("database.azure.com")
        ? { rejectUnauthorized: false }
        : undefined,
  });

  try {
    console.log("Connected to database");
    console.log(`Database: ${process.env.MYSQL_DATABASE}`);
    console.log(`Host: ${process.env.MYSQL_HOST}`);
    console.log(`SSL: ${connection.config.ssl ? "Enabled" : "Disabled"}\n`);

    // Check current column definition
    const [columns] = await connection.query(`
      SELECT 
        COLUMN_NAME,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'workflow_artifacts'
        AND COLUMN_NAME = 'brd_id'
    `, [process.env.MYSQL_DATABASE]) as [any[], any];

    if (!Array.isArray(columns) || columns.length === 0) {
      console.log("❌ Column 'brd_id' does not exist in workflow_artifacts table");
      console.log("   Run the migration script first: npm run add:brd-id-column");
      return;
    }

    const column = columns[0];
    console.log("Current column definition:");
    console.log(`  Column Name: ${column.COLUMN_NAME}`);
    console.log(`  Column Type: ${column.COLUMN_TYPE}`);
    console.log(`  Is Nullable: ${column.IS_NULLABLE}`);
    console.log(`  Column Default: ${column.COLUMN_DEFAULT || "NULL"}`);
    console.log(`  Column Key: ${column.COLUMN_KEY || "None"}\n`);

    if (column.IS_NULLABLE === "NO") {
      console.log("⚠️  Column is currently NOT NULL, but should allow NULL values");
      console.log("   Fixing column definition...\n");

      await connection.beginTransaction();

      try {
        // Alter column to allow NULL
        await connection.query(`
          ALTER TABLE workflow_artifacts
          MODIFY COLUMN brd_id VARCHAR(36) NULL
          COMMENT 'Link to BRD document (optional)'
        `);

        await connection.commit();
        console.log("✅ Successfully updated column to allow NULL values\n");

        // Verify the change
        const [updatedColumns] = await connection.query(`
          SELECT 
            COLUMN_NAME,
            COLUMN_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = 'workflow_artifacts'
            AND COLUMN_NAME = 'brd_id'
        `, [process.env.MYSQL_DATABASE]) as [any[], any];

        if (updatedColumns && updatedColumns.length > 0) {
          const updatedColumn = updatedColumns[0];
          console.log("Verified column definition:");
          console.log(`  Column Type: ${updatedColumn.COLUMN_TYPE}`);
          console.log(`  Is Nullable: ${updatedColumn.IS_NULLABLE}`);
          console.log(`  ✅ Column now allows NULL values`);
        }
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } else {
      console.log("✅ Column already allows NULL values - no changes needed");
    }
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

checkAndFixBrdIdColumn()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });


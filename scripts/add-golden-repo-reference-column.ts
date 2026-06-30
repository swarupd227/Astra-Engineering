import mysql from "mysql2/promise";

async function columnExists(
    connection: mysql.Connection,
    tableName: string,
    columnName: string
): Promise<boolean> {
    const [columns]: any = await connection.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() 
     AND TABLE_NAME = ? 
     AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Array.isArray(columns) && columns.length > 0;
}

async function applyMigration() {
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: parseInt(process.env.MYSQL_PORT || "3306"),
        ssl: {
            rejectUnauthorized: true,
        },
    });

    try {
        console.log("Connected to Azure MySQL database");

        // Start transaction
        await connection.beginTransaction();
        console.log("Starting migration transaction...");

        // Add golden_repo_reference column to sdlc_projects
        console.log("\n1. Updating sdlc_projects table...");
        if (!(await columnExists(connection, "sdlc_projects", "golden_repo_reference"))) {
            await connection.query(`
        ALTER TABLE sdlc_projects 
        ADD COLUMN golden_repo_reference JSON NULL 
        COMMENT 'Stores selected file paths from linked golden repository'
      `);
            console.log("  ✓ Added column: golden_repo_reference");
        } else {
            console.log("  - Column already exists: golden_repo_reference");
        }

        // Commit transaction
        await connection.commit();
        console.log("\n✅ Migration completed successfully!");
    } catch (error: any) {
        await connection.rollback();
        console.error("❌ Migration failed:", error);
        if (error.code === "ER_DUP_FIELDNAME") {
            console.log("  Column already exists, skipping...");
        } else {
            throw error;
        }
    } finally {
        await connection.end();
    }
}

applyMigration()
    .then(() => {
        console.log("Migration script completed");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Migration script failed:", err);
        process.exit(1);
    });


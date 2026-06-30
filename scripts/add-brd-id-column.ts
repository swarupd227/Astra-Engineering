// Script to add brd_id column to workflow_artifacts table
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Check if .env file exists (optional - dotenv will just use defaults if not found)
import { existsSync } from 'fs';
if (!existsSync(envPath)) {
    console.warn(`⚠️  Warning: .env file not found at: ${envPath}`);
    console.warn('   The script will use default values or environment variables.\n');
}

async function addBrdIdColumn() {
    let connection: mysql.Connection | null = null;

    try {
        // Debug: Show which values are being used (without showing password)
        console.log('📋 Database Configuration:');
        console.log(`   Host: ${process.env.MYSQL_HOST || 'localhost (default)'}`);
        console.log(`   Port: ${process.env.MYSQL_PORT || '3306 (default)'}`);
        console.log(`   User: ${process.env.MYSQL_USER || 'root (default)'}`);
        console.log(`   Database: ${process.env.MYSQL_DATABASE || 'devx (default)'}`);
        console.log(`   Password: ${process.env.MYSQL_PASSWORD ? '*** (set)' : '(not set)'}\n`);

        // Validate required environment variables
        if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD || !process.env.MYSQL_DATABASE) {
            console.warn('⚠️  Warning: Some environment variables are missing. Using defaults where available.');
            console.warn('   Make sure your .env file is in the project root and contains:');
            console.warn('   - MYSQL_HOST');
            console.warn('   - MYSQL_USER');
            console.warn('   - MYSQL_PASSWORD');
            console.warn('   - MYSQL_DATABASE');
            console.warn('   - MYSQL_PORT (optional, defaults to 3306)\n');
        }

        // Create connection with SSL for Azure MySQL
        // Azure MySQL requires SSL connections - always enable for Azure hosts
        const host = process.env.MYSQL_HOST || 'localhost';
        const isAzureMySQL = host.includes('azure.com') || host.includes('database.azure.com');

        // Always use SSL for Azure MySQL or if explicitly set
        const sslConfig = isAzureMySQL || process.env.MYSQL_SSL === 'true'
            ? { rejectUnauthorized: false }
            : undefined;

        if (isAzureMySQL) {
            console.log('🔒 Azure MySQL detected - SSL/TLS will be enabled\n');
        } else if (sslConfig) {
            console.log('🔒 Using SSL/TLS connection (MYSQL_SSL=true)\n');
        }

        // Create connection
        const connectionConfig: any = {
            host: process.env.MYSQL_HOST || 'localhost',
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || '',
            database: process.env.MYSQL_DATABASE || 'devx',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
        };

        // Add SSL config if needed
        if (sslConfig) {
            connectionConfig.ssl = sslConfig;
        }

        connection = await mysql.createConnection(connectionConfig);

        console.log('✅ Connected to database');

        // Explicitly select the database
        if (process.env.MYSQL_DATABASE) {
            await connection.query(`USE ${process.env.MYSQL_DATABASE}`);
            console.log(`✅ Using database: ${process.env.MYSQL_DATABASE}\n`);
        } else {
            throw new Error('MYSQL_DATABASE environment variable is not set');
        }

        // Check if column already exists
        const [columns] = await connection.execute(
            `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? 
         AND TABLE_NAME = 'workflow_artifacts' 
         AND COLUMN_NAME = 'brd_id'`,
            [process.env.MYSQL_DATABASE]
        );

        if (Array.isArray(columns) && columns.length > 0) {
            console.log('ℹ️  Column brd_id already exists in workflow_artifacts table');
            console.log('✅ No migration needed\n');
            return;
        }

        // Add the column
        console.log('📝 Adding brd_id column to workflow_artifacts table...');
        await connection.execute(
            `ALTER TABLE workflow_artifacts 
       ADD COLUMN brd_id VARCHAR(36) NULL 
       COMMENT 'Link to BRD document (optional)'`
        );

        console.log('✅ Successfully added brd_id column\n');

        // Verify the column was added
        const [verifyColumns] = await connection.execute(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? 
         AND TABLE_NAME = 'workflow_artifacts'
         AND COLUMN_NAME = 'brd_id'`,
            [process.env.MYSQL_DATABASE]
        );

        if (Array.isArray(verifyColumns) && verifyColumns.length > 0) {
            console.log('✅ Verification successful:');
            console.log(verifyColumns[0]);
        }

    } catch (error: any) {
        console.error('❌ Error adding brd_id column:', error.message);

        // Check if error is because column already exists
        if (error.message.includes('Duplicate column name')) {
            console.log('ℹ️  Column already exists - this is okay');
        } else {
            throw error;
        }
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n✅ Database connection closed');
        }
    }
}

addBrdIdColumn()
    .then(() => {
        console.log('\n✅ Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    });


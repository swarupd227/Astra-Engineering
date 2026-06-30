import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

async function runMigration() {
  console.log('[Migration] Starting database migration...');
  
  const connection = await createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'devx',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    multipleStatements: true,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('[Migration] Checking and adding columns...');
    
    // Helper function to add column if it doesn't exist
    const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
      const [rows]: any = await connection.query(
        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      
      if (rows[0].count === 0) {
        console.log(`  Adding ${column} to ${table}...`);
        await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      } else {
        console.log(`  Column ${column} already exists in ${table}, skipping...`);
      }
    };

    // Add columns to sdlc_epics
    await addColumnIfNotExists('sdlc_epics', 'source', "VARCHAR(50) DEFAULT 'manual'");
    await addColumnIfNotExists('sdlc_epics', 'workflow_session_id', "VARCHAR(36)");

    // Add columns to sdlc_backlog_items
    await addColumnIfNotExists('sdlc_backlog_items', 'brd_id', "VARCHAR(36)");
    await addColumnIfNotExists('sdlc_backlog_items', 'requirement_id', "VARCHAR(36)");
    await addColumnIfNotExists('sdlc_backlog_items', 'feature_id', "VARCHAR(36)");
    await addColumnIfNotExists('sdlc_backlog_items', 'epic_id', "VARCHAR(36)");
    await addColumnIfNotExists('sdlc_backlog_items', 'persona', "VARCHAR(255)");
    await addColumnIfNotExists('sdlc_backlog_items', 'persona_id', "VARCHAR(36)");
    await addColumnIfNotExists('sdlc_backlog_items', 'acceptance_criteria', "JSON");
    await addColumnIfNotExists('sdlc_backlog_items', 'subtasks', "JSON");
    await addColumnIfNotExists('sdlc_backlog_items', 'source', "VARCHAR(50) DEFAULT 'manual'");
    await addColumnIfNotExists('sdlc_backlog_items', 'workflow_session_id', "VARCHAR(36)");

    // Handle sdlc_features table - drop and recreate with correct schema
    const [tables]: any = await connection.query(
      `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sdlc_features'`
    );
    
    if (tables[0].count > 0) {
      console.log('  Dropping existing sdlc_features table to recreate with correct schema...');
      await connection.query('DROP TABLE sdlc_features');
    }
    
    // Extend user_roles.scope_id to hold comma-separated org/project IDs (ALL or id1,id2,...)
    try {
      await connection.query(
        `ALTER TABLE user_roles MODIFY COLUMN scope_id VARCHAR(500) NOT NULL`
      );
      console.log('  Extended user_roles.scope_id to VARCHAR(500)');
    } catch (alterErr: any) {
      // Ignore if column already correct length or table doesn't exist
      if (alterErr?.errno !== 1064) console.warn('  user_roles.scope_id alter:', alterErr?.message);
    }

    console.log('  Creating sdlc_features table with correct schema...');
    await connection.query(`
      CREATE TABLE sdlc_features (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL,
        phase_number INT NOT NULL,
        epic_id VARCHAR(36),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'planned',
        priority VARCHAR(50) DEFAULT 'medium',
        story_count INT DEFAULT 0,
        source VARCHAR(50) DEFAULT 'manual',
        workflow_session_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_phase (project_id, phase_number),
        INDEX idx_epic (epic_id),
        INDEX idx_workflow_session (workflow_session_id)
      )
    `);
    
    console.log('[Migration] ✅ Migration completed successfully!');
  } catch (error) {
    console.error('[Migration] ❌ Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});


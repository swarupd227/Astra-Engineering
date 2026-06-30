-- ============================================
-- Schema Migration Script: UAT to PROD
-- ============================================
-- Description: This script migrates database schema from UAT to PROD environment
-- Usage: 
--   mysql -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb < migrations/uat-to-prod-schema-migration.sql
-- 
-- IMPORTANT: 
--   1. Review this script before executing
--   2. Backup PROD database before running
--   3. Test in a non-production environment first
--   4. Schedule during maintenance window
--   5. Notify stakeholders before execution
-- ============================================

SET @source_db = 'uatdevxdb';
SET @target_db = 'devxdb';
SET @source_host = 'uatdevxmysqlserver.mysql.database.azure.com';
SET @target_host = 'devxserver.mysql.database.azure.com';

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================
-- Helper Procedure: Check if column exists
-- ============================================
DELIMITER $$

DROP PROCEDURE IF EXISTS AddColumnIfNotExists$$
CREATE PROCEDURE AddColumnIfNotExists(
    IN table_name VARCHAR(255),
    IN column_name VARCHAR(255),
    IN column_definition TEXT
)
BEGIN
    DECLARE column_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO column_count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name
      AND COLUMN_NAME = column_name;
    
    IF column_count = 0 THEN
        SET @sql = CONCAT('ALTER TABLE `', table_name, '` ADD COLUMN `', column_name, '` ', column_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column: ', table_name, '.', column_name) AS result;
    ELSE
        SELECT CONCAT('Column already exists: ', table_name, '.', column_name) AS result;
    END IF;
END$$

DELIMITER ;

-- ============================================
-- Helper Procedure: Check if table exists
-- ============================================
DELIMITER $$

DROP PROCEDURE IF EXISTS CreateTableIfNotExists$$
CREATE PROCEDURE CreateTableIfNotExists(
    IN table_name VARCHAR(255),
    IN create_statement TEXT
)
BEGIN
    DECLARE table_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO table_count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name;
    
    IF table_count = 0 THEN
        SET @sql = create_statement;
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Created table: ', table_name) AS result;
    ELSE
        SELECT CONCAT('Table already exists: ', table_name) AS result;
    END IF;
END$$

DELIMITER ;

-- ============================================
-- Create workflow_artifacts table if not exists
-- ============================================
CALL CreateTableIfNotExists('workflow_artifacts', 
    'CREATE TABLE workflow_artifacts (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36) NOT NULL,
      project_id VARCHAR(255),
      requirement LONGTEXT NOT NULL,
      guidelines LONGTEXT,
      epics JSON NOT NULL,
      features JSON NOT NULL,
      user_stories JSON NOT NULL,
      personas JSON NOT NULL,
      wiki_pages JSON NOT NULL,
      figma_guidelines LONGTEXT,
      status VARCHAR(50) NOT NULL DEFAULT ''draft'',
      modified TINYINT(1) DEFAULT 0,
      approval_status VARCHAR(20),
      modified_count INT DEFAULT 0,
      total_count INT DEFAULT 0,
      modified_items JSON NOT NULL DEFAULT (CAST('{\"epics\":[],\"features\":[],\"userStories\":[]}' AS JSON)),
      created_by VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_session_id (session_id),
      INDEX idx_project_id (project_id),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Add missing columns to workflow_artifacts if table exists
CALL AddColumnIfNotExists('workflow_artifacts', 'modified', "TINYINT(1) DEFAULT 0");
CALL AddColumnIfNotExists('workflow_artifacts', 'approval_status', "VARCHAR(20)");
CALL AddColumnIfNotExists('workflow_artifacts', 'modified_count', "INT DEFAULT 0");
CALL AddColumnIfNotExists('workflow_artifacts', 'total_count', "INT DEFAULT 0");
CALL AddColumnIfNotExists('workflow_artifacts', 'modified_items', "JSON NOT NULL DEFAULT (CAST('{\"epics\":[],\"features\":[],\"userStories\":[]}' AS JSON))");

-- Update existing rows to have default modified_items if they are NULL
UPDATE workflow_artifacts 
SET modified_items = CAST('{"epics":[],"features":[],"userStories":[]}' AS JSON)
WHERE modified_items IS NULL;

-- ============================================
-- Create workflow_subtasks table if not exists
-- ============================================
CALL CreateTableIfNotExists('workflow_subtasks',
    'CREATE TABLE workflow_subtasks (
      id VARCHAR(36) PRIMARY KEY,
      artifact_id VARCHAR(36) NOT NULL,
      user_story_id VARCHAR(36) NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      estimated_hours INT DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT ''pending'',
      assigned_to VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_artifact_id (artifact_id),
      INDEX idx_user_story_id (user_story_id),
      INDEX idx_status (status),
      FOREIGN KEY (artifact_id) REFERENCES workflow_artifacts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- ============================================
-- Add columns to sdlc_epics table
-- ============================================
CALL AddColumnIfNotExists('sdlc_epics', 'source', "VARCHAR(50) DEFAULT 'manual'");
CALL AddColumnIfNotExists('sdlc_epics', 'workflow_session_id', "VARCHAR(36)");

-- ============================================
-- Add columns to sdlc_backlog_items table
-- ============================================
CALL AddColumnIfNotExists('sdlc_backlog_items', 'feature_id', "VARCHAR(36)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'epic_id', "VARCHAR(36)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'persona', "VARCHAR(255)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'persona_id', "VARCHAR(36)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'acceptance_criteria', "JSON");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'subtasks', "JSON");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'source', "VARCHAR(50) DEFAULT 'manual'");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'workflow_session_id', "VARCHAR(36)");

-- ============================================
-- Add phase column to wiki_pages table
-- ============================================
CALL AddColumnIfNotExists('wiki_pages', 'phase', "VARCHAR(50) NOT NULL DEFAULT 'reference' COMMENT 'SDLC phase: planning, requirements, design, implementation, testing, deployment, reference'");

-- Update existing records if phase column was just added
UPDATE wiki_pages 
SET phase = 'planning' 
WHERE phase = 'reference' 
  AND page_type IN ('overview', 'feasibility-study', 'risk-assessment');

UPDATE wiki_pages 
SET phase = 'requirements' 
WHERE phase = 'reference' 
  AND page_type IN ('business-requirements', 'srs', 'use-cases', 'rtm', 'use-case-diagram', 'dfd');

UPDATE wiki_pages 
SET phase = 'design' 
WHERE phase = 'reference' 
  AND page_type IN ('technical-architecture', 'system-design', 'ui-ux-design', 'database-design', 'class-diagram', 'sequence-diagram', 'component-diagram', 'data-models');

UPDATE wiki_pages 
SET phase = 'implementation' 
WHERE phase = 'reference' 
  AND page_type IN ('features', 'api', 'coding-standards', 'version-control', 'infrastructure-diagram');

UPDATE wiki_pages 
SET phase = 'testing' 
WHERE phase = 'reference' 
  AND page_type IN ('testing', 'test-plan', 'test-cases', 'test-coverage-matrix');

UPDATE wiki_pages 
SET phase = 'deployment' 
WHERE phase = 'reference' 
  AND page_type IN ('deployment', 'release-notes', 'user-manual', 'maintenance-plan');

-- ============================================
-- Ensure sdlc_features table exists with correct schema
-- ============================================
-- Check if table exists, if not create it
SET @table_exists = 0;
SELECT COUNT(*) INTO @table_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sdlc_features';

SET @sql = IF(@table_exists = 0,
    'CREATE TABLE sdlc_features (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      epic_id VARCHAR(36),
      title VARCHAR(500) NOT NULL,
      description TEXT,
      status VARCHAR(50) DEFAULT ''planned'',
      priority VARCHAR(50) DEFAULT ''medium'',
      story_count INT DEFAULT 0,
      source VARCHAR(50) DEFAULT ''manual'',
      workflow_session_id VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number),
      INDEX idx_epic (epic_id),
      INDEX idx_workflow_session (workflow_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    'SELECT ''Table sdlc_features already exists'' AS result'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add missing columns to sdlc_features if table exists
CALL AddColumnIfNotExists('sdlc_features', 'source', "VARCHAR(50) DEFAULT 'manual'");
CALL AddColumnIfNotExists('sdlc_features', 'workflow_session_id', "VARCHAR(36)");

-- ============================================
-- Re-enable foreign key checks
-- ============================================
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================
-- Verification Queries
-- ============================================
SELECT 'Migration completed. Verifying schema...' AS status;

-- Show all tables
SELECT TABLE_NAME, TABLE_ROWS 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;

-- Show workflow_artifacts structure
DESCRIBE workflow_artifacts;

-- Show workflow_subtasks structure
DESCRIBE workflow_subtasks;

-- Show sdlc_epics columns
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sdlc_epics'
ORDER BY ORDINAL_POSITION;

-- Show sdlc_backlog_items columns
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sdlc_backlog_items'
ORDER BY ORDINAL_POSITION;

-- Show wiki_pages phase column
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'wiki_pages'
  AND COLUMN_NAME = 'phase';

-- ============================================
-- Cleanup helper procedures
-- ============================================
DROP PROCEDURE IF EXISTS AddColumnIfNotExists;
DROP PROCEDURE IF EXISTS CreateTableIfNotExists;

SELECT 'Schema migration from UAT to PROD completed successfully!' AS result;


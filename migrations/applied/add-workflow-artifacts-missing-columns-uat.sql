-- ============================================
-- Migration: Add Missing Columns to workflow_artifacts in UAT
-- ============================================
-- Description: Adds modified_count, total_count, and modified_items columns
--              that exist in QA but are missing in UAT
-- 
-- Usage (Linux/Mac/Git Bash):
--   mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/add-workflow-artifacts-missing-columns-uat.sql
--
-- Usage (PowerShell):
--   Get-Content migrations/add-workflow-artifacts-missing-columns-uat.sql | mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb
--   OR
--   cmd /c "mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/add-workflow-artifacts-missing-columns-uat.sql"
-- 
-- IMPORTANT: 
--   1. Review this script before executing
--   2. Backup UAT database before running
--   3. This script is idempotent - safe to run multiple times
-- ============================================

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
-- Add Missing Columns to workflow_artifacts
-- ============================================

-- Add modified_count column (int, default 0)
CALL AddColumnIfNotExists('workflow_artifacts', 'modified_count', "INT DEFAULT 0");

-- Add total_count column (int, default 0)
CALL AddColumnIfNotExists('workflow_artifacts', 'total_count', "INT DEFAULT 0");

-- Add modified_items column (json, NOT NULL, default '{"epics":[],"features":[],"userStories":[]}')
-- Note: MySQL JSON defaults require casting or using CAST/JSON_OBJECT
CALL AddColumnIfNotExists('workflow_artifacts', 'modified_items', "JSON NOT NULL DEFAULT (CAST('{\"epics\":[],\"features\":[],\"userStories\":[]}' AS JSON))");

-- Update existing rows to have default modified_items if they are NULL
UPDATE workflow_artifacts 
SET modified_items = CAST('{"epics":[],"features":[],"userStories":[]}' AS JSON)
WHERE modified_items IS NULL;

-- ============================================
-- Re-enable foreign key checks
-- ============================================
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================
-- Verification Queries
-- ============================================
SELECT 'Migration completed. Verifying schema...' AS status;

-- Show workflow_artifacts structure
DESCRIBE workflow_artifacts;

-- Show specific columns
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'workflow_artifacts'
  AND COLUMN_NAME IN ('modified_count', 'total_count', 'modified_items')
ORDER BY ORDINAL_POSITION;

-- ============================================
-- Cleanup helper procedures
-- ============================================
DROP PROCEDURE IF EXISTS AddColumnIfNotExists;

SELECT 'Migration to add missing columns to workflow_artifacts in UAT completed successfully!' AS result;


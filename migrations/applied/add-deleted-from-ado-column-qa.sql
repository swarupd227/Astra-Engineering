-- Migration: Add deleted_from_ado column to sdlc_projects table (QA)
-- Date: 2025-01-XX
-- Description: Adds deletedFromAdo field to track if project is deleted from Azure DevOps (soft delete)

USE qadevxdb;

-- Check if column exists before adding (idempotent)
SET @column_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'qadevxdb' 
    AND TABLE_NAME = 'sdlc_projects' 
    AND COLUMN_NAME = 'deleted_from_ado'
);

-- Add column if it doesn't exist
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE sdlc_projects ADD COLUMN deleted_from_ado TINYINT(1) DEFAULT 0 NOT NULL AFTER status',
    'SELECT "Column deleted_from_ado already exists, skipping..." AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify the column was added
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'qadevxdb' 
AND TABLE_NAME = 'sdlc_projects' 
AND COLUMN_NAME = 'deleted_from_ado';


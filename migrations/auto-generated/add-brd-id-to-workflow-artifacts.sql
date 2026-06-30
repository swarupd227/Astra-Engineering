-- Migration: add-brd-id-to-workflow-artifacts
-- Created: 2024-01-XX
-- Description: Add brd_id column to workflow_artifacts table to link artifacts to BRD documents

-- ============================================
-- IMPORTANT: Select your database first
-- ============================================
-- Replace 'your_database_name' with your actual database name
-- USE your_database_name;

-- ============================================
-- Pre-checks
-- ============================================

-- Verify table exists
SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'workflow_artifacts';

-- Check if column already exists
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'workflow_artifacts' 
  AND COLUMN_NAME = 'brd_id';

-- ============================================
-- Migration SQL
-- ============================================

-- Add brd_id column (MySQL doesn't support IF NOT EXISTS for ADD COLUMN)
-- Check manually first using the pre-check query above
ALTER TABLE workflow_artifacts 
  ADD COLUMN brd_id VARCHAR(36) NULL 
  COMMENT 'Link to BRD document (optional)';

-- ============================================
-- Verification queries
-- ============================================

-- Verify the column was added
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'workflow_artifacts'
  AND COLUMN_NAME = 'brd_id';

-- ============================================
-- Rollback instructions (if needed)
-- ============================================

-- To rollback this migration:
-- ALTER TABLE workflow_artifacts DROP COLUMN IF EXISTS brd_id;


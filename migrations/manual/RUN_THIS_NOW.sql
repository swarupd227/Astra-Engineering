-- =====================================================
-- URGENT: Run this migration NOW to fix the save artifacts error
-- =====================================================
-- Error: Unknown column 'requirement_ids' in 'field list'
-- This adds the missing requirement_ids column to workflow_artifacts
-- =====================================================

-- Step 1: Check if the column already exists
SELECT 
  COUNT(*) as column_exists,
  'If this shows 1, the column already exists and you can skip this migration' as note
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'workflow_artifacts'
  AND COLUMN_NAME = 'requirement_ids';

-- Step 2: Add the column (run this if step 1 shows 0)
ALTER TABLE workflow_artifacts 
ADD COLUMN requirement_ids JSON 
AFTER brd_id;

-- Step 3: Set default value for existing rows
UPDATE workflow_artifacts 
SET requirement_ids = JSON_ARRAY() 
WHERE requirement_ids IS NULL;

-- Step 4: Verify the column was added successfully
SELECT 
  COLUMN_NAME, 
  DATA_TYPE, 
  IS_NULLABLE, 
  COLUMN_TYPE,
  'This should show: requirement_ids | json | YES | json' as expected
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'workflow_artifacts'
  AND COLUMN_NAME = 'requirement_ids';

-- Step 5: Verify data in table
SELECT 
  id,
  project_id,
  brd_id,
  requirement_ids,
  created_at
FROM workflow_artifacts 
LIMIT 5;

-- Success! The migration is complete.

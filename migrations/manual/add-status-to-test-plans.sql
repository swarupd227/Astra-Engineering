-- Migration: Add status column to test_plan_documents
-- Description: Adds a status column to track 'active' vs 'deleted' test plans explicitly.

ALTER TABLE test_plan_documents ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'active' AFTER content;

-- Update existing deleted records based on deleted_at
UPDATE test_plan_documents SET status = 'deleted' WHERE deleted_at IS NOT NULL;

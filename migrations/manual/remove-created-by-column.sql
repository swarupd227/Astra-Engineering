-- Migration: Remove unused created_by column from test_plan_documents
-- Description: Removes the created_by column to clean up the schema as it is unused.

ALTER TABLE test_plan_documents DROP COLUMN created_by;

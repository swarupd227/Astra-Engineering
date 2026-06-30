-- Add columns to store the generated BRD markdown and JSON structure in dev_brd_documents table
-- This allows repopulating the BRD document UI when selecting an existing BRD

-- Note: MySQL doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- If columns already exist, this will fail with "Duplicate column name" error
-- This is expected behavior - the error indicates the migration has already been applied

ALTER TABLE dev_brd_documents
  ADD COLUMN generated_markdown LONGTEXT NULL,
  ADD COLUMN generated_brd_json JSON NULL;




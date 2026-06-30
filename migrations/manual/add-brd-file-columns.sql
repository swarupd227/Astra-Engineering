-- Add columns to store the generated BRD file in dev_brd_documents table
-- This migration adds: brd_file, brd_file_name, brd_file_type, brd_file_size

-- Note: MySQL doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- If columns already exist, this will fail with "Duplicate column name" error
-- This is expected behavior - the error indicates the migration has already been applied

ALTER TABLE dev_brd_documents
  ADD COLUMN brd_file LONGBLOB NULL,
  ADD COLUMN brd_file_name VARCHAR(255) NULL,
  ADD COLUMN brd_file_type VARCHAR(100) NULL,
  ADD COLUMN brd_file_size BIGINT NULL;


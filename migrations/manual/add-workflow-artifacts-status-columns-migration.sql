-- Migration: Add modified and approval_status columns to workflow_artifacts table
-- Description: Adds a boolean modified column and an approval_status column with approved/not approved values

-- Add modified column (boolean)
ALTER TABLE workflow_artifacts 
ADD COLUMN modified BOOLEAN DEFAULT FALSE;

-- Add approval_status column (approved or not approved)
ALTER TABLE workflow_artifacts 
ADD COLUMN approval_status VARCHAR(20) DEFAULT NULL;

-- Add index on approval_status for better query performance
-- Note: MySQL doesn't support IF NOT EXISTS for CREATE INDEX in older versions
-- If the index already exists, this will fail - you can safely ignore the error
CREATE INDEX idx_approval_status ON workflow_artifacts(approval_status);


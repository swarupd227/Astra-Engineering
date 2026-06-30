-- Add missing columns to artifact_organizations
ALTER TABLE artifact_organizations 
ADD COLUMN IF NOT EXISTS project_name TEXT,
ADD COLUMN IF NOT EXISTS organization_url TEXT,
ADD COLUMN IF NOT EXISTS pat_token TEXT;

-- Add missing columns to conversational_ui_settings
ALTER TABLE conversational_ui_settings 
ADD COLUMN IF NOT EXISTS repository_name TEXT,
ADD COLUMN IF NOT EXISTS project_name TEXT,
ADD COLUMN IF NOT EXISTS organization_url TEXT,
ADD COLUMN IF NOT EXISTS pat_token TEXT;

-- Add missing columns to workflow_settings
ALTER TABLE workflow_settings 
ADD COLUMN IF NOT EXISTS repository_name TEXT,
ADD COLUMN IF NOT EXISTS project_name TEXT,
ADD COLUMN IF NOT EXISTS organization_url TEXT,
ADD COLUMN IF NOT EXISTS pat_token TEXT;

-- Create personas table
CREATE TABLE IF NOT EXISTS personas (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  color TEXT NOT NULL,
  focus TEXT NOT NULL,
  pain_points JSON NOT NULL,
  goals JSON NOT NULL,
  is_default INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

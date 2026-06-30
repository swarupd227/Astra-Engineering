-- Migration: Add workflow_artifacts and workflow_subtasks tables
-- Description: Creates tables to store generated epics, features, user stories, personas, wiki pages, and figma guidelines

-- Create workflow_artifacts table
CREATE TABLE IF NOT EXISTS workflow_artifacts (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(255),
  requirement LONGTEXT NOT NULL,
  guidelines LONGTEXT,
  epics JSON NOT NULL,
  features JSON NOT NULL,
  user_stories JSON NOT NULL,
  personas JSON NOT NULL,
  wiki_pages JSON NOT NULL,
  figma_guidelines LONGTEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_project_id (project_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create workflow_subtasks table
CREATE TABLE IF NOT EXISTS workflow_subtasks (
  id VARCHAR(36) PRIMARY KEY,
  artifact_id VARCHAR(36) NOT NULL,
  user_story_id VARCHAR(36) NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_hours INT DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  assigned_to VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_artifact_id (artifact_id),
  INDEX idx_user_story_id (user_story_id),
  INDEX idx_status (status),
  FOREIGN KEY (artifact_id) REFERENCES workflow_artifacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Align project_id collation with sdlc_projects so queries work correctly.
-- FK constraint is intentionally omitted: sdlc_projects.project_id collation varies
-- per environment and a type-mismatch error would crash the migration.
ALTER TABLE workflow_artifacts
MODIFY COLUMN project_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
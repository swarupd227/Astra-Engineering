-- Add workflow-related columns to existing tables

-- Add columns to sdlc_epics
ALTER TABLE sdlc_epics 
ADD COLUMN source VARCHAR(50) DEFAULT 'manual',
ADD COLUMN workflow_session_id VARCHAR(36);

-- Add columns to sdlc_backlog_items
ALTER TABLE sdlc_backlog_items 
ADD COLUMN feature_id VARCHAR(36),
ADD COLUMN epic_id VARCHAR(36),
ADD COLUMN persona VARCHAR(255),
ADD COLUMN persona_id VARCHAR(36),
ADD COLUMN acceptance_criteria JSON,
ADD COLUMN subtasks JSON,
ADD COLUMN source VARCHAR(50) DEFAULT 'manual',
ADD COLUMN workflow_session_id VARCHAR(36);

-- Create sdlc_features table if it doesn't exist
CREATE TABLE IF NOT EXISTS sdlc_features (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  phase_number INT NOT NULL,
  epic_id VARCHAR(36),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'planned',
  priority VARCHAR(50) DEFAULT 'medium',
  story_count INT DEFAULT 0,
  source VARCHAR(50) DEFAULT 'manual',
  workflow_session_id VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_phase (project_id, phase_number),
  INDEX idx_epic (epic_id),
  INDEX idx_workflow_session (workflow_session_id)
);


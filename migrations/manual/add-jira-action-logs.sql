-- Jira action audit log table
-- Tracks every Jira write operation for per-user attribution and debugging.

CREATE TABLE IF NOT EXISTS jira_action_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  sdlc_project_id VARCHAR(36) DEFAULT NULL,
  jira_project_key VARCHAR(100) DEFAULT NULL,
  action VARCHAR(100) NOT NULL,
  issue_key VARCHAR(100) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_id (user_id),
  KEY idx_sdlc_project_id (sdlc_project_id),
  KEY idx_created_at (created_at)
);

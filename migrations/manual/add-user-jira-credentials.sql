-- Per-user Jira PAT credentials table
-- Each DevX user stores their own Jira API token so Jira activity is attributed to the real person.

CREATE TABLE IF NOT EXISTS user_jira_credentials (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  instance_url VARCHAR(500) NOT NULL,
  email VARCHAR(255) NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  account_id VARCHAR(100) DEFAULT NULL,
  display_name VARCHAR(255) DEFAULT NULL,
  last_tested_at TIMESTAMP NULL DEFAULT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_instance (user_id, instance_url),
  KEY idx_user_id (user_id)
);

-- Relax jira_connections: email and api_token_encrypted become nullable
-- (retained for legacy admin reads and instance URL discovery)
ALTER TABLE jira_connections MODIFY COLUMN email VARCHAR(255) DEFAULT NULL;
ALTER TABLE jira_connections MODIFY COLUMN api_token_encrypted TEXT DEFAULT NULL;

-- Relax jira_settings: email and api_token_encrypted become nullable
ALTER TABLE jira_settings MODIFY COLUMN email VARCHAR(255) DEFAULT NULL;
ALTER TABLE jira_settings MODIFY COLUMN api_token_encrypted TEXT DEFAULT NULL;

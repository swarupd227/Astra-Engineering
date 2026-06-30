CREATE TABLE IF NOT EXISTS user_project_repo_credentials (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  base_url VARCHAR(500) NOT NULL,
  token_encrypted TEXT NOT NULL,
  external_user_id VARCHAR(100) NULL,
  username VARCHAR(255) NULL,
  last_tested_at TIMESTAMP NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY uniq_user_project_repo (user_id, project_id, provider, base_url)
);

CREATE TABLE IF NOT EXISTS user_project_integration_credentials (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  integration_kind VARCHAR(50) NOT NULL,
  integration_id VARCHAR(100) NOT NULL,
  provider_key VARCHAR(100) NULL,
  last_test_status VARCHAR(20) DEFAULT 'untested',
  last_test_message TEXT NULL,
  last_tested_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY ux_user_project_integration_credentials (
    user_id,
    project_id,
    integration_kind,
    integration_id
  )
);

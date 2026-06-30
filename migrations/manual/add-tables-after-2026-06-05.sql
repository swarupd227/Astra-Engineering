-- qadevxdb_test3 / brownfield: tables added after 2026-06-05 + app-runtime tables
-- that were missing from the original baseline (project_members, user_git_credentials).
-- Idempotent (CREATE TABLE IF NOT EXISTS). Aligned with shared/schema.ts + server/db.ts.

-- 1. project_git_config
CREATE TABLE IF NOT EXISTS project_git_config (
  id CHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  provider ENUM('github', 'ado') NOT NULL DEFAULT 'ado',
  branch VARCHAR(255) NOT NULL DEFAULT 'main',
  base_path VARCHAR(512) NULL,
  ado_repository_id VARCHAR(36) NULL,
  ado_repository_name VARCHAR(255) NULL,
  token TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_project_git_config_project_id (project_id)
);

-- 2. token_usage_logs
CREATE TABLE IF NOT EXISTS token_usage_logs (
  id CHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  tokens_consumed BIGINT NOT NULL,
  model_name VARCHAR(100) NOT NULL DEFAULT 'BRD_STANDARD_COST',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_token_usage_logs_tenant_id (tenant_id),
  KEY idx_token_usage_logs_user_id (user_id),
  KEY idx_token_usage_logs_created_at (created_at)
);

-- 3. artifact_events
CREATE TABLE IF NOT EXISTS artifact_events (
  id CHAR(36) PRIMARY KEY,
  artifact_id VARCHAR(100) NULL,
  use_case VARCHAR(50) NULL,
  user_id VARCHAR(100) NULL,
  project_id VARCHAR(100) NULL,
  status VARCHAR(50) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  tokens_used INT NULL,
  processing_time_ms INT NULL,
  KEY idx_artifact_events_use_case (use_case),
  KEY idx_artifact_events_created_at (created_at)
);

-- 4. universal_ai_usage_logs
CREATE TABLE IF NOT EXISTS universal_ai_usage_logs (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) DEFAULT NULL,
  tenant_id VARCHAR(36) DEFAULT NULL,
  team_id VARCHAR(100) DEFAULT NULL,
  project_id VARCHAR(100) DEFAULT NULL,
  session_id VARCHAR(36) DEFAULT NULL,
  correlation_id VARCHAR(36) DEFAULT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'claude',
  model_name VARCHAR(255) NOT NULL,
  feature_name VARCHAR(100) DEFAULT NULL,
  use_case VARCHAR(100) DEFAULT NULL,
  request_status VARCHAR(20) NOT NULL DEFAULT 'success',
  quality_decision VARCHAR(20) NOT NULL DEFAULT 'unrated',
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  latency_ms INT DEFAULT NULL,
  request_metadata JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_uaiul_user_created (user_id, created_at),
  KEY idx_uaiul_provider_created (provider, created_at),
  KEY idx_uaiul_usecase_created (use_case, created_at),
  KEY idx_uaiul_created (created_at),
  KEY idx_uaiul_quality (quality_decision),
  KEY idx_uaiul_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. jira_team_members
CREATE TABLE IF NOT EXISTS jira_team_members (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) DEFAULT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  jira_display_name VARCHAR(255) DEFAULT NULL,
  jira_email VARCHAR(255) DEFAULT NULL,
  instance_url VARCHAR(500) NOT NULL,
  project_id VARCHAR(36) DEFAULT NULL,
  project_key VARCHAR(100) NOT NULL,
  project_name VARCHAR(255) DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  match_method VARCHAR(20) NOT NULL DEFAULT 'unmatched',
  match_confidence DECIMAL(4,3) DEFAULT NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jtm_natural (instance_url(191), project_key, jira_account_id),
  KEY idx_jtm_user (user_id),
  KEY idx_jtm_project (project_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. jira_user_overrides
CREATE TABLE IF NOT EXISTS jira_user_overrides (
  id VARCHAR(36) NOT NULL,
  instance_url VARCHAR(500) NOT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_juo (instance_url(191), jira_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. productivity_targets
CREATE TABLE IF NOT EXISTS productivity_targets (
  id VARCHAR(36) NOT NULL,
  period_type VARCHAR(20) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_saved_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pt_period (period_type, period_start, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. organization_members
CREATE TABLE IF NOT EXISTS organization_members (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  invited_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_org_member (organization_id, user_id)
);

-- 9. user_project_repo_credentials
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_project_repo (user_id, project_id, provider, base_url)
);

-- 10. user_project_integration_credentials
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_user_project_integration_credentials (
    user_id,
    project_id,
    integration_kind,
    integration_id
  )
);

-- 11. project_members (was only created at app-boot in server/db.ts; missing from baseline)
CREATE TABLE IF NOT EXISTS project_members (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  invited_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_project_member (project_id, user_id)
);

-- 12. user_git_credentials (was only created at app-boot in server/db.ts; missing from baseline)
CREATE TABLE IF NOT EXISTS user_git_credentials (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  base_url VARCHAR(500) NOT NULL,
  token_encrypted TEXT NOT NULL,
  external_user_id VARCHAR(100) NULL,
  username VARCHAR(255) NULL,
  last_tested_at TIMESTAMP NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_git (user_id, provider, base_url)
);

-- 13. user_gitlab_credentials (live-only table; DDL sourced from SHOW CREATE TABLE)
CREATE TABLE IF NOT EXISTS user_gitlab_credentials (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  base_url VARCHAR(500) NOT NULL DEFAULT 'https://gitlab.com',
  token_encrypted TEXT NOT NULL,
  gitlab_user_id VARCHAR(100) DEFAULT NULL,
  username VARCHAR(255) DEFAULT NULL,
  last_tested_at TIMESTAMP NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_gitlab (user_id, base_url)
);

-- 14. dev_brd_document_versions (live-only table; DDL sourced from SHOW CREATE TABLE)
CREATE TABLE IF NOT EXISTS dev_brd_document_versions (
  id VARCHAR(36) NOT NULL,
  brd_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  version_number INT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'candidate',
  parent_version_id VARCHAR(36) DEFAULT NULL,
  generated_brd_json JSON DEFAULT NULL,
  generated_markdown LONGTEXT,
  llm_summary_json JSON DEFAULT NULL,
  diff_json JSON DEFAULT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_dev_brd_document_version (brd_id, version_number),
  KEY idx_dev_brd_document_versions_brd_status (brd_id, status)
);

-- 15. dev_brd_review_threads
CREATE TABLE IF NOT EXISTS dev_brd_review_threads (
  id VARCHAR(36) NOT NULL,
  brd_id VARCHAR(36) NOT NULL,
  version_id VARCHAR(36) NOT NULL,
  section_key VARCHAR(255) DEFAULT NULL,
  section_title VARCHAR(255) DEFAULT NULL,
  anchor_type VARCHAR(50) NOT NULL DEFAULT 'document',
  title VARCHAR(500) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dev_brd_review_threads_version_status (version_id, status),
  KEY idx_dev_brd_review_threads_brd_version (brd_id, version_id)
);

-- 16. dev_brd_review_messages
CREATE TABLE IF NOT EXISTS dev_brd_review_messages (
  id VARCHAR(36) NOT NULL,
  thread_id VARCHAR(36) NOT NULL,
  author_id VARCHAR(36) NOT NULL,
  author_name VARCHAR(255) NOT NULL,
  author_role VARCHAR(50) NOT NULL DEFAULT 'Reviewer',
  body LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dev_brd_review_messages_thread_created (thread_id, created_at)
);

-- 17. dev_brd_review_events
CREATE TABLE IF NOT EXISTS dev_brd_review_events (
  id VARCHAR(36) NOT NULL,
  brd_id VARCHAR(36) NOT NULL,
  version_id VARCHAR(36) DEFAULT NULL,
  actor_id VARCHAR(36) NOT NULL,
  actor_name VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  detail LONGTEXT,
  metadata_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dev_brd_review_events_brd_created (brd_id, created_at)
);

-- 18. dev_brd_review_completions
CREATE TABLE IF NOT EXISTS dev_brd_review_completions (
  id VARCHAR(36) NOT NULL,
  brd_id VARCHAR(36) NOT NULL,
  version_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(36) NOT NULL,
  reviewer_name VARCHAR(255) NOT NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_dev_brd_review_completion (version_id, reviewer_id),
  KEY idx_dev_brd_review_completions_brd_version (brd_id, version_id)
);

-- 19. dev_brd_review_applied_comments
CREATE TABLE IF NOT EXISTS dev_brd_review_applied_comments (
  id VARCHAR(36) NOT NULL,
  source_version_id VARCHAR(36) NOT NULL,
  target_version_id VARCHAR(36) NOT NULL,
  thread_id VARCHAR(36) NOT NULL,
  summary LONGTEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dev_brd_applied_source_thread (source_version_id, thread_id),
  KEY idx_dev_brd_applied_target (target_version_id)
);

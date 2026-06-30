-- Tables that existed in qadevxdb_test3 but were missing from migration scripts.
-- DDL sourced directly from SHOW CREATE TABLE on the live database.
-- All statements are CREATE TABLE IF NOT EXISTS — safe to re-run.

-- user_gitlab_credentials
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dev_brd_document_versions
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dev_brd_review_threads
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dev_brd_review_messages
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dev_brd_review_events
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dev_brd_review_completions
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dev_brd_review_applied_comments
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

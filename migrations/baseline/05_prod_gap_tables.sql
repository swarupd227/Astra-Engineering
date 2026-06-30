-- =============================================================================
-- Production-only / late-added tables not present in older SQL snapshots.
-- Merged into 00_full_schema.sql by generate-full-schema-baseline.js
-- For 100% DDL fidelity run: node scripts/generate-full-schema-baseline.js (with MYSQL_*)
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `integration_tool_catalog` (
  `id` varchar(36) NOT NULL,
  `category_key` varchar(100) NOT NULL,
  `provider_key` varchar(100) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `is_active` tinyint NOT NULL DEFAULT 1,
  `supports_testing` tinyint NOT NULL DEFAULT 1,
  `required_fields` json NOT NULL,
  `test_config` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_catalog_category_provider` (`category_key`,`provider_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `org_integration_configs` (
  `id` varchar(36) NOT NULL,
  `org_type` varchar(50) NOT NULL,
  `org_id` varchar(36) NOT NULL,
  `tool_catalog_id` varchar(36) NOT NULL,
  `config` json NOT NULL,
  `secrets_encrypted` longtext,
  `last_test_status` varchar(20) DEFAULT 'untested',
  `last_test_message` text,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `project_integration_configs` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `category_key` varchar(100) NOT NULL,
  `use_org_default` tinyint NOT NULL DEFAULT 1,
  `org_integration_config_id` varchar(36) DEFAULT NULL,
  `tool_catalog_id` varchar(36) DEFAULT NULL,
  `config` json DEFAULT NULL,
  `secrets_encrypted` longtext,
  `last_test_status` varchar(20) DEFAULT 'untested',
  `last_test_message` text,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_project_category` (`project_id`,`category_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_project_tool_configs` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `tool_key` varchar(100) NOT NULL,
  `config` json DEFAULT NULL,
  `enabled` tinyint NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sdlc_project_tool_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `gitlab_settings` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `gitlab_url` text NOT NULL,
  `access_token` text,
  `default_branch` varchar(255) DEFAULT 'main',
  `config` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_types` (
  `id` varchar(36) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `is_active` tinyint NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `license_types_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_features` (
  `id` varchar(36) NOT NULL,
  `license_type_id` varchar(36) NOT NULL,
  `feature_key` varchar(100) NOT NULL,
  `enabled` tinyint NOT NULL DEFAULT 1,
  `limits` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_license_features_type` (`license_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_metadata` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `metadata` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_license_metadata_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_cache` (
  `id` varchar(36) NOT NULL,
  `cache_key` varchar(255) NOT NULL,
  `payload` json NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `license_cache_key_unique` (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_audit_log` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `details` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_license_audit_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `devx_license_keys` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `license_key` text NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_devx_license_keys_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_seats` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `seat_type` varchar(50) NOT NULL DEFAULT 'standard',
  `assigned_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_seats_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `feature_usage` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `feature_key` varchar(100) NOT NULL,
  `usage_count` bigint NOT NULL DEFAULT 0,
  `period_start` date DEFAULT NULL,
  `period_end` date DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feature_usage_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_activity_logs` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `activity_type` varchar(100) NOT NULL,
  `resource_type` varchar(100) DEFAULT NULL,
  `resource_id` varchar(255) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_activity_user` (`user_id`),
  KEY `idx_user_activity_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `prompt_logs` (
  `id` varchar(36) NOT NULL,
  `prompt_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `session_id` varchar(255) DEFAULT NULL,
  `model_name` varchar(100) DEFAULT NULL,
  `tokens_used` int DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_generation_jobs` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `progress` int DEFAULT 0,
  `error_message` text,
  `result` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `specs_generation_jobs` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `progress` int DEFAULT 0,
  `error_message` text,
  `config` json DEFAULT NULL,
  `result` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_specs_gen_jobs_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_specs_drafts` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `title` varchar(500) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'draft',
  `content` longtext,
  `metadata` json DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_brd_specs_drafts_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_specs_draft_files` (
  `id` varchar(36) NOT NULL,
  `draft_id` varchar(36) NOT NULL,
  `file_name` varchar(500) NOT NULL,
  `file_path` text,
  `mime_type` varchar(100) DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `content` longtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_brd_specs_draft_files_draft` (`draft_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `security_scan_configs` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `scan_type` varchar(50) NOT NULL,
  `enabled` tinyint NOT NULL DEFAULT 1,
  `config` json DEFAULT NULL,
  `schedule` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_security_scan_configs_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `security_scan_jobs` (
  `id` varchar(36) NOT NULL,
  `config_id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `findings` json DEFAULT NULL,
  `error_message` text,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_security_scan_jobs_config` (`config_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `client_feedback` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `rating` int DEFAULT NULL,
  `message` text NOT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_push_metadata` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `issue_key` varchar(100) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(36) NOT NULL,
  `push_status` varchar(50) NOT NULL DEFAULT 'pending',
  `jira_response` json DEFAULT NULL,
  `error_message` text,
  `pushed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_jira_push_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

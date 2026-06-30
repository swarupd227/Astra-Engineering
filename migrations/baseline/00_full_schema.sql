-- =============================================================================
-- DevX — FULL database schema (all tables, prod parity)
-- Generated: 2026-05-29T10:07:47.484Z
-- DO NOT EDIT BY HAND — run: node scripts/generate-full-schema-baseline.js
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `hash` text NOT NULL,
  `created_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `accessibility_scan_results` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `url` text NOT NULL,
  `status` text NOT NULL,
  `overall_score` int DEFAULT NULL,
  `violations_count` int DEFAULT '0',
  `passes_count` int DEFAULT '0',
  `incomplete_count` int DEFAULT '0',
  `inapplicable_count` int DEFAULT '0',
  `critical_count` int DEFAULT '0',
  `serious_count` int DEFAULT '0',
  `moderate_count` int DEFAULT '0',
  `minor_count` int DEFAULT '0',
  `violations` json DEFAULT NULL,
  `passes` json DEFAULT NULL,
  `incomplete` json DEFAULT NULL,
  `wcag_criteria` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `screen_reader_result` json DEFAULT NULL,
  `visual_test_result` json DEFAULT NULL,
  `ai_analysis` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ado_configurations` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `organization` text NOT NULL,
  `project` text NOT NULL,
  `pat` text NOT NULL,
  `is_active` int DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ado_design_sync` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL DEFAULT '2',
  `last_sync_at` timestamp NULL DEFAULT NULL,
  `sync_status` text NOT NULL DEFAULT (_utf8mb4'pending'),
  `synced_items_count` int DEFAULT '0',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ado_settings` (
  `id` varchar(36) NOT NULL,
  `organization_url` text NOT NULL,
  `project_name` text NOT NULL,
  `repository` text,
  `branch` text,
  `pat_token` text,
  `api_version` text NOT NULL DEFAULT (_utf8mb4'7.0'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ai_enhance_mappings` (
  `id` varchar(36) NOT NULL,
  `location_key` varchar(255) NOT NULL,
  `repository_id` varchar(64) NOT NULL,
  `folder_path` text NOT NULL,
  `file_path` text NOT NULL,
  `file_name` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ai_sessions` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `project_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to msal_users.id',
  `title` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'AI-generated or user-renamed title',
  `status` enum('IN_PROGRESS','PAUSED','COMPLETED','INACTIVE') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IN_PROGRESS',
  `current_screen` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Screen/route where user left off',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_accessed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT 'Soft delete',
  PRIMARY KEY (`id`),
  KEY `idx_project_user` (`project_id`,`user_id`,`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_status` (`status`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_last_accessed_at` (`last_accessed_at`),
  CONSTRAINT `fk_ai_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `msal_users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_usage_logs` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `call_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Unique identifier for this API call',
  `model` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g., gpt-4o, gpt-4-turbo, claude-3-opus',
  `provider` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'azure' COMMENT 'azure, anthropic, openai',
  `input_tokens` int NOT NULL DEFAULT '0',
  `output_tokens` int NOT NULL DEFAULT '0',
  `total_tokens` int NOT NULL DEFAULT '0',
  `input_price_per_1k` decimal(10,6) NOT NULL DEFAULT '0.000000' COMMENT 'Price per 1K input tokens',
  `output_price_per_1k` decimal(10,6) NOT NULL DEFAULT '0.000000' COMMENT 'Price per 1K output tokens',
  `cost` decimal(12,6) NOT NULL DEFAULT '0.000000' COMMENT 'Calculated cost for this call',
  `request_metadata` json DEFAULT NULL COMMENT 'Additional request metadata',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_call_id` (`call_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_model` (`model`),
  KEY `idx_provider` (`provider`),
  CONSTRAINT `fk_ai_usage_logs_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `api_baseline_executions` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `baseline_id` varchar(255) NOT NULL,
  `status` text NOT NULL,
  `status_code` int DEFAULT NULL,
  `response_time` int DEFAULT NULL,
  `actual_response` json DEFAULT NULL,
  `differences` json DEFAULT NULL,
  `summary` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `api_baselines` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `name` text NOT NULL,
  `description` text,
  `method` text NOT NULL,
  `endpoint` text NOT NULL,
  `request_headers` json DEFAULT NULL,
  `request_body` text,
  `baseline_response` json DEFAULT NULL,
  `baseline_status_code` int DEFAULT NULL,
  `baseline_headers` json DEFAULT NULL,
  `response_schema` json DEFAULT NULL,
  `last_executed_at` timestamp NULL DEFAULT NULL,
  `last_execution_status` text,
  `execution_count` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `api_discovery_runs` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) DEFAULT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `discovery_type` text NOT NULL,
  `source_url` text,
  `spec_content` json DEFAULT NULL,
  `endpoints` json DEFAULT NULL,
  `status` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_events` (
  `id` char(36) NOT NULL,
  `artifact_id` varchar(100) NOT NULL,
  `use_case` varchar(50) NOT NULL,
  `user_id` varchar(100) NOT NULL,
  `project_id` varchar(100) NOT NULL,
  `status` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tokens_used` int NOT NULL,
  `processing_time_ms` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_artifact_events_use_case` (`use_case`),
  KEY `idx_artifact_events_project_id` (`project_id`),
  KEY `idx_artifact_events_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_generation_jobs` (
  `job_id` char(36) NOT NULL,
  `session_id` varchar(36) DEFAULT NULL,
  `job_type` varchar(50) NOT NULL DEFAULT 'council',
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `progress` int NOT NULL DEFAULT '0',
  `step` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `result` longtext,
  `error` longtext,
  `quality_report` json DEFAULT NULL,
  `generation_logs` json DEFAULT NULL,
  `domain_expert_analysis` json DEFAULT NULL,
  `council_data` json DEFAULT NULL,
  PRIMARY KEY (`job_id`),
  KEY `idx_artifact_jobs_session_id` (`session_id`),
  KEY `idx_artifact_jobs_status` (`status`),
  KEY `idx_artifact_jobs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_organizations` (
  `id` varchar(36) NOT NULL,
  `project_name` text NOT NULL,
  `organization_url` text NOT NULL,
  `pat_token` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` char(36) NOT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `target_user_id` varchar(36) NOT NULL,
  `action` enum('ROLE_ASSIGNED','ROLE_REMOVED','USER_SOFT_DELETED') NOT NULL,
  `role` varchar(50) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_actor` (`actor_user_id`),
  KEY `idx_audit_logs_target` (`target_user_id`),
  KEY `idx_audit_logs_tenant` (`tenant_id`),
  KEY `idx_audit_logs_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_cases` (
  `id` varchar(255) NOT NULL,
  `run_id` varchar(255) NOT NULL,
  `title` text NOT NULL,
  `priority` text NOT NULL,
  `category` text NOT NULL,
  `page_url` text,
  `description` text,
  `steps` json DEFAULT NULL,
  `expected_result` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_executions` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) NOT NULL,
  `script_id` varchar(255) DEFAULT NULL,
  `status` text NOT NULL,
  `total` int DEFAULT '0',
  `passed` int DEFAULT '0',
  `failed` int DEFAULT '0',
  `skipped` int DEFAULT '0',
  `results` json DEFAULT NULL,
  `executed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_pages` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) NOT NULL,
  `url` text NOT NULL,
  `title` text,
  `forms` int DEFAULT '0',
  `buttons` int DEFAULT '0',
  `inputs` int DEFAULT '0',
  `links` int DEFAULT '0',
  `dom_data` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_runs` (
  `id` varchar(255) NOT NULL,
  `url` text NOT NULL,
  `status` text NOT NULL,
  `page_count` int DEFAULT '0',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_scripts` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `test_case_ids` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_cases` (
  `id` char(36) NOT NULL,
  `crawl_run_id` char(36) NOT NULL,
  `page_id` char(36) DEFAULT NULL,
  `case_code` varchar(64) NOT NULL,
  `title` varchar(512) NOT NULL,
  `test_type` varchar(64) NOT NULL DEFAULT 'ui',
  `steps` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_cases_crawl_run_id` (`crawl_run_id`),
  KEY `idx_automated_test_cases_page_id` (`page_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_pages` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `page_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g., search, product_detail, cart, checkout',
  `route_pattern` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g., /product/:id, /search',
  `sample_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Example URL for this page type',
  `user_role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'guest, user, admin',
  `page_signature_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `crawl_run_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `title` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `depth` int NOT NULL DEFAULT '0',
  `parent_page_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_count` int NOT NULL DEFAULT '0',
  `form_count` int NOT NULL DEFAULT '0',
  `element_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `automated_test_pages_run_route_role` (`crawl_run_id`,`route_pattern`,`user_role`),
  KEY `idx_page_type` (`page_type`),
  KEY `idx_user_role` (`user_role`),
  KEY `idx_page_signature` (`page_signature_hash`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Registry of logical page types discovered by Page Discovery Agent';

CREATE TABLE IF NOT EXISTS `automated_test_results` (
  `id` char(36) NOT NULL,
  `test_run_id` char(36) NOT NULL,
  `test_case_id` char(36) NOT NULL,
  `case_code` varchar(64) DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `severity` varchar(20) DEFAULT NULL,
  `error_message` text,
  `duration_ms` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_results_test_run_id` (`test_run_id`),
  KEY `idx_automated_test_results_test_case_id` (`test_case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_runs` (
  `id` char(36) NOT NULL,
  `crawl_run_id` char(36) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `total_tests` int NOT NULL DEFAULT '0',
  `passed_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL DEFAULT NULL,
  `error_message` text,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_runs_crawl_run_id` (`crawl_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_scripts` (
  `id` char(36) NOT NULL,
  `crawl_run_id` char(36) NOT NULL,
  `file_name` varchar(255) NOT NULL DEFAULT 'autonomous.spec.ts',
  `script_content` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_scripts_crawl_run_id` (`crawl_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automation_scripts` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) DEFAULT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `script_type` text NOT NULL,
  `pattern` text NOT NULL,
  `file_name` text NOT NULL,
  `file_path` text NOT NULL,
  `content` text NOT NULL,
  `page_url` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bdd_feature_files` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) NOT NULL,
  `test_case_id` varchar(255) DEFAULT NULL,
  `test_case_source` text,
  `feature_name` text NOT NULL,
  `file_name` text NOT NULL,
  `content` text NOT NULL,
  `language` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bdd_step_definitions` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) NOT NULL,
  `feature_file_id` varchar(255) DEFAULT NULL,
  `step_def_name` text NOT NULL,
  `file_name` text NOT NULL,
  `content` text NOT NULL,
  `language` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_documents` (
  `id` char(36) NOT NULL,
  `project_id` char(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `project_description` longtext,
  `business_objectives` longtext,
  `success_criteria` longtext,
  `target_audience` longtext,
  `stakeholders` longtext,
  `key_features` longtext,
  `existing_requirements` longtext,
  `constraints` longtext,
  `timeline` longtext,
  `budget` longtext,
  `project_details` longtext,
  `acceptance_criteria` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_file_versions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `brd_id` char(36) NOT NULL,
  `version` int NOT NULL,
  `file_blob` longblob NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(100) NOT NULL,
  `file_size` bigint DEFAULT NULL,
  `uploaded_by` char(36) DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brd_id` (`brd_id`,`version`),
  KEY `brd_id_2` (`brd_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_generation_jobs` (
  `job_id` char(36) NOT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'processing',
  `progress_json` json DEFAULT NULL,
  `step` varchar(500) NOT NULL DEFAULT 'BRD generation started',
  `error` longtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`job_id`),
  KEY `brd_generation_jobs_brd_id_idx` (`brd_id`),
  KEY `brd_generation_jobs_status_created_at_idx` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_generation_metrics` (
  `id` varchar(36) NOT NULL,
  `job_id` varchar(36) NOT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `project_id` varchar(36) NOT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `duration_ms` bigint DEFAULT NULL,
  `brd_template_id` varchar(50) NOT NULL DEFAULT 'gold_1_0',
  `brd_generation_mode` varchar(50) DEFAULT NULL,
  `rag_used` tinyint(1) NOT NULL DEFAULT '0',
  `rag_pipeline_mode` varchar(50) DEFAULT NULL,
  `rag_guidance_length_chars` int DEFAULT NULL,
  `rag_guidance_length_estimate_tokens` int DEFAULT NULL,
  `prompt_sizes` json DEFAULT NULL,
  `rag_stats` json DEFAULT NULL,
  `canonical_requirement_count` int DEFAULT NULL,
  `extracted_requirement_row_count` int DEFAULT NULL,
  `traceability_entry_count` int DEFAULT NULL,
  `source_coverage_percent` decimal(5,2) DEFAULT NULL,
  `traceability_score` int DEFAULT NULL,
  `brd_accuracy_score` int DEFAULT NULL,
  `domain_profile_compliance_score` int DEFAULT NULL,
  `unsupported_requirement_percent` decimal(5,2) DEFAULT NULL,
  `acceptance_status` varchar(50) DEFAULT NULL,
  `acceptance_reasons` json DEFAULT NULL,
  `rtm_json` json DEFAULT NULL,
  `quality_metrics_json` json DEFAULT NULL,
  `acceptance_summary_json` json DEFAULT NULL,
  `phase_durations_ms` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `llm_provider` varchar(50) DEFAULT 'openai_integrations',
  `brd_chat_model` varchar(120) DEFAULT NULL,
  `brd_repair_chat_model` varchar(120) DEFAULT NULL,
  `brd_extraction_chat_model` varchar(120) DEFAULT NULL,
  `llm_models_json` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brd_gen_metrics_job_idx` (`job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_specs_draft_files` (
  `id` char(36) NOT NULL,
  `draft_id` varchar(36) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(100) NOT NULL,
  `file_size` bigint NOT NULL DEFAULT '0',
  `file_blob` longblob,
  `page_count` int DEFAULT NULL,
  `upload_status` varchar(50) NOT NULL DEFAULT 'uploaded',
  `extraction_status` varchar(50) NOT NULL DEFAULT 'ready',
  `extracted_characters` int NOT NULL DEFAULT '0',
  `warnings_json` json DEFAULT NULL,
  `content_hash` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bsdf_draft` (`draft_id`),
  KEY `idx_brd_specs_draft_files_draft_id` (`draft_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_specs_drafts` (
  `id` char(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `status` enum('draft','extracting','extracted','generating','validating','completed','failed','archived') NOT NULL DEFAULT 'draft',
  `bundle_title` varchar(255) DEFAULT NULL,
  `current_step` varchar(255) NOT NULL DEFAULT 'Draft created',
  `current_step_detail` text,
  `progress` int NOT NULL DEFAULT '0',
  `review_state_json` json DEFAULT NULL,
  `extraction_result_json` json DEFAULT NULL,
  `coverage_report_json` json DEFAULT NULL,
  `latest_generation_job_id` varchar(36) DEFAULT NULL,
  `created_by_user_id` varchar(36) DEFAULT NULL,
  `last_updated_by_user_id` varchar(36) DEFAULT NULL,
  `error_message` text,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `archived_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bsd_project` (`project_id`),
  KEY `idx_brd_specs_drafts_project_archived` (`project_id`,`archived_at`),
  KEY `idx_brd_specs_drafts_project_updated` (`project_id`,`updated_at`),
  KEY `idx_brd_specs_drafts_latest_job` (`latest_generation_job_id`),
  KEY `idx_brd_specs_drafts_created_by` (`created_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `client_feedback` (
  `id` char(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `description` text,
  `screenshots` json DEFAULT NULL,
  `category` varchar(50) DEFAULT 'general',
  `status` varchar(50) DEFAULT 'pending',
  `details` json DEFAULT NULL,
  `ado_work_item_id` int DEFAULT NULL,
  `ado_status` varchar(100) DEFAULT NULL,
  `pushed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `conversational_ui_settings` (
  `id` varchar(36) NOT NULL,
  `organization_name` text NOT NULL,
  `project_name` text NOT NULL,
  `pat_token` text,
  `api_version` varchar(20) NOT NULL DEFAULT '7.0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ConversationSummary` (
  `conversation_id` varchar(36) NOT NULL,
  `summary` text,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`conversation_id`),
  CONSTRAINT `fk_summary_titles` FOREIGN KEY (`conversation_id`) REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ConversationTitles` (
  `conversation_id` varchar(36) NOT NULL,
  `user_id` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `crawl_runs` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `base_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Starting URL for crawl',
  `environment` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'prod, staging, qa, etc',
  `user_role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL DEFAULT NULL,
  `pages_discovered` int NOT NULL DEFAULT '0',
  `dom_versions_created` int NOT NULL DEFAULT '0',
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'running' COMMENT 'running, success, failed, cancelled',
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `config` json DEFAULT NULL COMMENT 'Crawl configuration (depth, limits, etc)',
  `project_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `organization_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_environment` (`environment`),
  KEY `idx_user_role` (`user_role`),
  KEY `idx_status` (`status`),
  KEY `idx_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Operational tracking for crawl executions and debugging';

CREATE TABLE IF NOT EXISTS `design_guidelines` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL DEFAULT 'Generated Design Guidelines',
  `type` varchar(100) NOT NULL DEFAULT 'Design Guidelines',
  `content` longtext NOT NULL,
  `figma_link` text,
  `user_prompt` text,
  `guidelines_content` longtext,
  `ado_work_item_id` int DEFAULT NULL,
  `ado_pushed_at` timestamp NULL DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `generated_prompt` longtext NOT NULL COMMENT 'AI-generated base design guideline prompt used as immutable context for Phase-2',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `design_mappings` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `epic_id` varchar(100) NOT NULL,
  `epic_title` text NOT NULL,
  `user_stories` json NOT NULL,
  `prompt` longtext NOT NULL,
  `figma_link` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `brd_id` varchar(256) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_epic_id` (`epic_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_chat_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `brd_id` char(36) NOT NULL,
  `sender` enum('user','assistant') NOT NULL,
  `message` longtext NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `brd_id` (`brd_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_documents` (
  `id` char(36) NOT NULL,
  `project_id` char(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `project_description` longtext,
  `business_objectives` longtext,
  `success_criteria` longtext,
  `target_audience` longtext,
  `key_stakeholders` longtext,
  `key_features` longtext,
  `existing_requirements` longtext,
  `constraints` longtext,
  `timeline` longtext,
  `budget` longtext,
  `approval_status` varchar(50) NOT NULL DEFAULT 'draft',
  `generation_status` varchar(50) NOT NULL DEFAULT 'not_started',
  `created_by` char(36) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'draft',
  `updated_by` char(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `brd_file` longblob,
  `brd_file_name` varchar(255) DEFAULT NULL,
  `brd_file_type` varchar(100) DEFAULT NULL,
  `brd_file_size` bigint DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `generated_markdown` longtext,
  `generated_brd_json` json DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `project_id` (`project_id`),
  KEY `idx_dev_brd_project_approval_deleted_updated` (`project_id`,`approval_status`,`deleted_at`,`updated_at`),
  KEY `idx_dev_brd_project_generation` (`project_id`,`generation_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_file_versions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `brd_id` char(36) NOT NULL,
  `version` int NOT NULL,
  `file_blob` longblob NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(100) NOT NULL,
  `file_size` bigint DEFAULT NULL,
  `uploaded_by` char(36) DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brd_id` (`brd_id`,`version`),
  KEY `brd_id_2` (`brd_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_phase_progress` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `brd_id` char(36) NOT NULL,
  `phase` enum('backlog','design','development','testing','deployment','maintenance') NOT NULL,
  `status` enum('not_started','in_progress','partial','completed','blocked') DEFAULT 'not_started',
  `progress_percentage` int DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `brd_id` (`brd_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_requirements` (
  `id` char(36) NOT NULL,
  `project_id` char(36) NOT NULL,
  `brd_id` char(36) NOT NULL,
  `workflow_id` char(36) DEFAULT NULL,
  `requirement_name` varchar(255) NOT NULL,
  `description` longtext,
  `priority` varchar(20) NOT NULL DEFAULT 'medium',
  `acceptance_criteria` longtext,
  `status` varchar(30) NOT NULL DEFAULT 'new',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_brd_id` (`brd_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_dev_brd_requirements_brd` FOREIGN KEY (`brd_id`) REFERENCES `dev_brd_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_document_versions` (
  `id` varchar(36) NOT NULL,
  `brd_id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `version_number` int NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'candidate',
  `parent_version_id` varchar(36) DEFAULT NULL,
  `generated_brd_json` json DEFAULT NULL,
  `generated_markdown` longtext,
  `llm_summary_json` json DEFAULT NULL,
  `diff_json` json DEFAULT NULL,
  `created_by` varchar(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dev_brd_document_version` (`brd_id`,`version_number`),
  KEY `idx_dev_brd_document_versions_brd_status` (`brd_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_review_applied_comments` (
  `id` varchar(36) NOT NULL,
  `source_version_id` varchar(36) NOT NULL,
  `target_version_id` varchar(36) NOT NULL,
  `thread_id` varchar(36) NOT NULL,
  `summary` longtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_brd_applied_source_thread` (`source_version_id`,`thread_id`),
  KEY `idx_dev_brd_applied_target` (`target_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_review_completions` (
  `id` varchar(36) NOT NULL,
  `brd_id` varchar(36) NOT NULL,
  `version_id` varchar(36) NOT NULL,
  `reviewer_id` varchar(36) NOT NULL,
  `reviewer_name` varchar(255) NOT NULL,
  `completed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dev_brd_review_completion` (`version_id`,`reviewer_id`),
  KEY `idx_dev_brd_review_completions_brd_version` (`brd_id`,`version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_review_events` (
  `id` varchar(36) NOT NULL,
  `brd_id` varchar(36) NOT NULL,
  `version_id` varchar(36) DEFAULT NULL,
  `actor_id` varchar(36) NOT NULL,
  `actor_name` varchar(255) NOT NULL,
  `action` varchar(100) NOT NULL,
  `detail` longtext,
  `metadata_json` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_brd_review_events_brd_created` (`brd_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_review_messages` (
  `id` varchar(36) NOT NULL,
  `thread_id` varchar(36) NOT NULL,
  `author_id` varchar(36) NOT NULL,
  `author_name` varchar(255) NOT NULL,
  `author_role` varchar(50) NOT NULL DEFAULT 'Reviewer',
  `body` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_brd_review_messages_thread_created` (`thread_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_review_threads` (
  `id` varchar(36) NOT NULL,
  `brd_id` varchar(36) NOT NULL,
  `version_id` varchar(36) NOT NULL,
  `section_key` varchar(255) DEFAULT NULL,
  `section_title` varchar(255) DEFAULT NULL,
  `anchor_type` varchar(50) NOT NULL DEFAULT 'document',
  `title` varchar(500) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'open',
  `created_by` varchar(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_brd_review_threads_version_status` (`version_id`,`status`),
  KEY `idx_dev_brd_review_threads_brd_version` (`brd_id`,`version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_workflow_brd_attachments` (
  `id` char(36) NOT NULL,
  `workflow_id` char(36) NOT NULL,
  `brd_version_id` bigint NOT NULL,
  `attached_by` char(36) DEFAULT NULL,
  `attached_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workflow_id` (`workflow_id`),
  KEY `brd_version_id` (`brd_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `development_branches` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `is_default` int NOT NULL DEFAULT '0',
  `is_protected` int NOT NULL DEFAULT '0',
  `commits` int DEFAULT '0',
  `last_commit_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `development_repositories` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `default_branch` text DEFAULT (_utf8mb4'main'),
  `commits` int DEFAULT '0',
  `contributors` int DEFAULT '1',
  `size` text DEFAULT (_utf8mb4'0 MB'),
  `license` text DEFAULT (_utf8mb4'MIT'),
  `last_commit_at` timestamp NULL DEFAULT NULL,
  `repository_url` text,
  `status` text NOT NULL DEFAULT (_utf8mb4'active'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `devx_guideline_chunks` (
  `id` varchar(36) NOT NULL,
  `guideline_id` varchar(36) NOT NULL,
  `chunk_index` int NOT NULL,
  `chunk_text` longtext NOT NULL,
  `qdrant_point_id` varchar(255) NOT NULL,
  `chunk_size` int NOT NULL,
  `overlap_size` int NOT NULL DEFAULT '0',
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_devx_guideline_chunks_guideline_id` (`guideline_id`),
  KEY `idx_devx_guideline_chunks_guideline_id_chunk_index` (`guideline_id`,`chunk_index`),
  CONSTRAINT `fk_devx_guideline_chunks_guideline` FOREIGN KEY (`guideline_id`) REFERENCES `devx_vectorized_guidelines` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `devx_license_keys` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(36) NOT NULL,
  `key_value` varchar(50) NOT NULL,
  `plan_type` enum('starter','professional','enterprise') NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `valid_until` date DEFAULT NULL,
  `activated_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key_value` (`key_value`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_key_value` (`key_value`),
  KEY `idx_plan_type` (`plan_type`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `devx_rag_sessions` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `session_type` varchar(50) NOT NULL DEFAULT 'artifact_generation',
  `status` varchar(50) NOT NULL DEFAULT 'processing',
  `requirement_ids` json DEFAULT NULL,
  `guideline_ids` json DEFAULT NULL,
  `cache_hit_count` int NOT NULL DEFAULT '0',
  `cache_miss_count` int NOT NULL DEFAULT '0',
  `total_processing_time_ms` int DEFAULT NULL,
  `rag_processing_time_ms` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_devx_rag_sessions_project_id` (`project_id`),
  KEY `idx_devx_rag_sessions_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `devx_vectorized_guidelines` (
  `id` varchar(36) NOT NULL,
  `golden_repo_id` varchar(36) DEFAULT NULL,
  `guideline_name` varchar(500) NOT NULL,
  `content_hash` varchar(64) NOT NULL,
  `qdrant_collection` varchar(255) NOT NULL,
  `chunk_count` int NOT NULL DEFAULT '0',
  `embedding_model` varchar(100) NOT NULL DEFAULT 'text-embedding-ada-002',
  `status` varchar(50) NOT NULL DEFAULT 'processing',
  `processing_time_ms` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_devx_vectorized_guidelines_content_hash` (`content_hash`),
  UNIQUE KEY `uk_devx_vec_guidelines_repo_file_hash` (`golden_repo_id`,`guideline_name`,`content_hash`),
  KEY `idx_devx_vectorized_guidelines_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dom_actions` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `dom_version_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g., checkout, add_to_cart, login',
  `action_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'navigate, submit, open_modal, etc',
  `selector` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Stable selector (data-testid, aria-label, etc)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dom_version_id` (`dom_version_id`),
  KEY `idx_action_name` (`action_name`),
  KEY `idx_action_type` (`action_type`),
  CONSTRAINT `dom_actions_ibfk_1` FOREIGN KEY (`dom_version_id`) REFERENCES `page_dom_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Actionable elements (buttons, CTAs) for test flow generation';

CREATE TABLE IF NOT EXISTS `dom_forms` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `dom_version_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `form_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `submit_action` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fields` json NOT NULL COMMENT 'Array of {name, type, required, selector}',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dom_version_id` (`dom_version_id`),
  KEY `idx_form_name` (`form_name`),
  CONSTRAINT `dom_forms_ibfk_1` FOREIGN KEY (`dom_version_id`) REFERENCES `page_dom_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Extracted forms for test generation and validation';

CREATE TABLE IF NOT EXISTS `execution_results` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `test_case_id` varchar(255) NOT NULL,
  `status` text NOT NULL,
  `execution_time` int NOT NULL,
  `screenshot_url` text,
  `error_log` text,
  `console_errors` json DEFAULT NULL,
  `network_errors` json DEFAULT NULL,
  `actual_result` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `execution_run_tests` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) NOT NULL,
  `test_case_id` varchar(255) NOT NULL,
  `test_case_source` text NOT NULL,
  `test_name` text NOT NULL,
  `category` text NOT NULL,
  `status` text NOT NULL,
  `duration` int DEFAULT '0',
  `step_results` json DEFAULT NULL,
  `final_screenshot_path` text,
  `error_message` text,
  `console_errors` json DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `execution_runs` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `run_name` text NOT NULL,
  `browser` text NOT NULL,
  `execution_mode` text NOT NULL,
  `status` text NOT NULL,
  `total_tests` int NOT NULL DEFAULT '0',
  `passed_tests` int DEFAULT '0',
  `failed_tests` int DEFAULT '0',
  `skipped_tests` int DEFAULT '0',
  `duration` int DEFAULT '0',
  `video_path` text,
  `agent_logs` json DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `feature_usage` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `feature_code` varchar(100) NOT NULL,
  `usage_timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `session_id` varchar(36) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `file_summary` (
  `file_summary_id` char(36) NOT NULL,
  `Chat_session_ID` char(36) NOT NULL,
  `file_ID` char(36) NOT NULL,
  `file_name` varchar(1024) NOT NULL,
  `file_summary` mediumtext NOT NULL,
  `created_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  `updated_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  PRIMARY KEY (`file_summary_id`),
  KEY `idx_file_summary_file` (`file_ID`),
  KEY `idx_file_summary_session` (`Chat_session_ID`),
  CONSTRAINT `fk_file_summary_file` FOREIGN KEY (`file_ID`) REFERENCES `workflow_attached_documents` (`file_ID`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_file_summary_session` FOREIGN KEY (`Chat_session_ID`) REFERENCES `workflow_conversation_titles` (`chat_session_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `framework_configs` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `name` text NOT NULL,
  `framework` text NOT NULL,
  `language` text NOT NULL,
  `description` text,
  `is_global` tinyint(1) DEFAULT '0',
  `base_class` text,
  `sample_script` text,
  `detected_pattern` text,
  `detected_language` text,
  `detected_tool` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `framework_files` (
  `id` varchar(255) NOT NULL,
  `config_id` varchar(255) NOT NULL,
  `filename` text NOT NULL,
  `file_hash` text,
  `content` text NOT NULL,
  `file_type` text NOT NULL,
  `parsed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `framework_functions` (
  `id` varchar(255) NOT NULL,
  `config_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `signature` text NOT NULL,
  `description` text,
  `category` text NOT NULL,
  `return_type` text,
  `parameters` json DEFAULT NULL,
  `source_file` text,
  `class_name` text,
  `import_path` text,
  `is_custom` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `functional_test_run_cases` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `run_id` varchar(255) NOT NULL,
  `test_id` text NOT NULL,
  `category` text NOT NULL,
  `name` text NOT NULL,
  `objective` text,
  `preconditions` json DEFAULT NULL,
  `test_steps` json NOT NULL,
  `expected_result` text NOT NULL,
  `test_data` json DEFAULT NULL,
  `priority` text,
  `status` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `functional_test_runs` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `website_url` text NOT NULL,
  `test_focus` text NOT NULL,
  `domain` text,
  `product_context` text,
  `sample_mode` text,
  `status` text NOT NULL,
  `total_test_cases` int DEFAULT '0',
  `workflow_cases` int DEFAULT '0',
  `functional_cases` int DEFAULT '0',
  `negative_cases` int DEFAULT '0',
  `edge_cases` int DEFAULT '0',
  `text_validation_cases` int DEFAULT '0',
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `functional_test_sessions` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `url` text NOT NULL,
  `test_focus` text NOT NULL,
  `crawl_status` text NOT NULL,
  `pages_visited` int DEFAULT '0',
  `workflows_discovered` int DEFAULT '0',
  `test_cases_generated` int DEFAULT '0',
  `test_cases_passed` int DEFAULT '0',
  `test_cases_failed` int DEFAULT '0',
  `crawl_progress` json DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `gitlab_settings` (
  `id` char(36) NOT NULL,
  `base_url` text NOT NULL,
  `pat_token` text,
  `is_active` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `golden_repo_organizations` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `organization_url` text NOT NULL,
  `project_name` text NOT NULL,
  `repository_name` text,
  `api_version` text NOT NULL DEFAULT (_utf8mb4'7.0'),
  `pat_token` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `golden_repositories` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `technologies` json NOT NULL,
  `stars` int NOT NULL DEFAULT '0',
  `cloud_provider` text,
  `repository_url` text,
  `category` text,
  `domain` text NOT NULL DEFAULT (_utf8mb4'insurance'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `guideline_chunks` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `guideline_id` varchar(36) NOT NULL,
  `chunk_index` int NOT NULL,
  `chunk_text` longtext NOT NULL,
  `qdrant_point_id` varchar(255) NOT NULL,
  `chunk_size` int NOT NULL,
  `overlap_size` int NOT NULL DEFAULT '0',
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_guideline_id` (`guideline_id`),
  KEY `idx_chunk_index` (`guideline_id`,`chunk_index`),
  KEY `idx_qdrant_point` (`qdrant_point_id`),
  CONSTRAINT `guideline_chunks_ibfk_1` FOREIGN KEY (`guideline_id`) REFERENCES `vectorized_guidelines` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Stores individual chunks of vectorized guidelines with Qdrant references';

CREATE TABLE IF NOT EXISTS `har_captures` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `discovery_run_id` varchar(255) DEFAULT NULL,
  `url` text NOT NULL,
  `method` text NOT NULL,
  `request_headers` json DEFAULT NULL,
  `request_body` text,
  `status_code` int DEFAULT NULL,
  `response_headers` json DEFAULT NULL,
  `response_body` text,
  `duration` int DEFAULT NULL,
  `captured_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `integration_configs` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `user_id` varchar(255) NOT NULL,
  `platform` text NOT NULL,
  `name` text NOT NULL,
  `config` json NOT NULL,
  `status` text NOT NULL,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `last_error` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `integration_settings` (
  `id` varchar(36) NOT NULL,
  `setting_key` varchar(255) NOT NULL,
  `setting_value` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `project_id` varchar(36) NOT NULL DEFAULT '',
  `integration_type` varchar(50) NOT NULL DEFAULT 'ado',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `integration_tool_catalog` (
  `id` char(36) NOT NULL,
  `category_key` varchar(100) NOT NULL,
  `provider_key` varchar(100) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `supports_testing` tinyint NOT NULL DEFAULT '1',
  `required_fields` json NOT NULL,
  `test_config` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_catalog_category_provider` (`category_key`,`provider_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `integrations` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `integration_type` varchar(50) NOT NULL,
  `api_key` varchar(255) NOT NULL,
  `app_key` varchar(255) DEFAULT NULL,
  `base_url` varchar(255) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `organization_id` varchar(36) DEFAULT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_action_logs` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `sdlc_project_id` varchar(36) DEFAULT NULL,
  `jira_project_key` varchar(100) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `issue_key` varchar(100) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'success',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_sdlc_project_id` (`sdlc_project_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_connections` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `instance_url` text NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `api_token_encrypted` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_admin_connection` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_push_metadata` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(36) NOT NULL,
  `artifact_id` varchar(36) NOT NULL,
  `artifact_type` varchar(20) NOT NULL,
  `jira_issue_key` varchar(50) NOT NULL,
  `jira_issue_id` varchar(50) NOT NULL,
  `pushed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_settings` (
  `id` varchar(36) NOT NULL,
  `base_url` text NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `api_token` text,
  `project_key` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `project_id` varchar(36) NOT NULL DEFAULT '',
  `connection_id` varchar(36) DEFAULT NULL,
  `instance_url` varchar(500) NOT NULL DEFAULT '',
  `api_token_encrypted` text,
  `story_points_field_id` varchar(100) DEFAULT NULL,
  `epic_link_field_id` varchar(100) DEFAULT NULL,
  `sprint_field_id` varchar(100) DEFAULT NULL,
  `acceptance_criteria_field_id` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `confluence_space_key` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_test_cases` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `jira_project_key` text NOT NULL,
  `jira_board_id` int DEFAULT NULL,
  `jira_sprint_id` int DEFAULT NULL,
  `jira_story_id` text NOT NULL,
  `jira_story_title` text NOT NULL,
  `test_case_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `objective` text,
  `preconditions` json DEFAULT NULL,
  `test_steps` json NOT NULL,
  `expected_result` text,
  `postconditions` json DEFAULT NULL,
  `test_data` json DEFAULT NULL,
  `test_type` text,
  `category` text NOT NULL,
  `priority` text,
  `playwright_script` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_team_members` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `jira_account_id` varchar(128) NOT NULL,
  `jira_display_name` varchar(255) DEFAULT NULL,
  `jira_email` varchar(255) DEFAULT NULL,
  `instance_url` varchar(500) NOT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `project_key` varchar(100) NOT NULL,
  `project_name` varchar(255) DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `match_method` varchar(20) NOT NULL DEFAULT 'unmatched',
  `match_confidence` decimal(4,3) DEFAULT NULL,
  `synced_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jtm_natural` (`instance_url`(191),`project_key`,`jira_account_id`),
  KEY `idx_jtm_user` (`user_id`),
  KEY `idx_jtm_project` (`project_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jira_user_overrides` (
  `id` varchar(36) NOT NULL,
  `instance_url` varchar(500) NOT NULL,
  `jira_account_id` varchar(128) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_juo` (`instance_url`(191),`jira_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `license_audit_log` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `action` varchar(50) NOT NULL,
  `performed_by` varchar(36) DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_cache` (
  `tenant_id` varchar(36) NOT NULL,
  `license_data` json NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_features` (
  `id` varchar(36) NOT NULL,
  `license_id` varchar(36) NOT NULL,
  `feature_code` varchar(50) NOT NULL,
  `is_enabled` tinyint(1) DEFAULT '1',
  `usage_limit` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_keys` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `license_hash` varchar(255) NOT NULL,
  `salt` varchar(255) NOT NULL,
  `integrity_hash` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_metadata` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `license_key_id` varchar(36) NOT NULL,
  `features` json DEFAULT NULL,
  `limits` json DEFAULT NULL,
  `valid_from` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` timestamp NULL DEFAULT NULL,
  `status` varchar(20) DEFAULT 'active',
  `metadata` json DEFAULT NULL,
  `last_validated` timestamp NULL DEFAULT NULL,
  `validation_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `license_types` (
  `id` varchar(36) NOT NULL,
  `type_code` varchar(50) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `description` text,
  `max_users` int DEFAULT '5',
  `max_projects` int DEFAULT '3',
  `features` json DEFAULT NULL,
  `quota_limits` json DEFAULT NULL,
  `trial_days` int DEFAULT '14',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `key_prefix` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `type_code` (`type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `message_summary` (
  `message_summary_ID` char(36) NOT NULL,
  `Chat_session_ID` char(36) NOT NULL,
  `conversation_title` varchar(512) DEFAULT NULL,
  `message_summary` mediumtext NOT NULL,
  `created_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  `updated_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  PRIMARY KEY (`message_summary_ID`),
  KEY `idx_msg_summary_session` (`Chat_session_ID`),
  CONSTRAINT `fk_message_summary_session` FOREIGN KEY (`Chat_session_ID`) REFERENCES `workflow_conversation_titles` (`chat_session_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `Messages` (
  `id` varchar(36) NOT NULL,
  `conversation_id` varchar(36) NOT NULL,
  `role` enum('user','assistant','system') NOT NULL,
  `content` text NOT NULL,
  `created_at` bigint NOT NULL,
  `is_summarised` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_messages_titles` (`conversation_id`),
  CONSTRAINT `fk_messages_titles` FOREIGN KEY (`conversation_id`) REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `modernization_analyses` (
  `id` char(36) NOT NULL,
  `session_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `ado_org` varchar(255) DEFAULT NULL,
  `ado_project_id` varchar(255) DEFAULT NULL,
  `ado_project_name` varchar(255) DEFAULT NULL,
  `modernization_type` varchar(50) NOT NULL DEFAULT 'tech_upgrade',
  `llm_provider` varchar(50) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'initiated',
  `current_stage` varchar(100) DEFAULT NULL,
  `progress` int NOT NULL DEFAULT '0',
  `selected_phases` json DEFAULT NULL,
  `repo_name` varchar(255) DEFAULT NULL,
  `stack_summary` varchar(500) DEFAULT NULL,
  `git_branch` varchar(255) DEFAULT NULL,
  `git_file_count` int DEFAULT '0',
  `errors` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mod_analyses_project` (`ado_org`,`ado_project_id`),
  KEY `idx_mod_analyses_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `modernization_phase_outputs` (
  `id` char(36) NOT NULL,
  `analysis_id` char(36) NOT NULL,
  `phase` varchar(50) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `metadata` json DEFAULT NULL,
  `report_markdown` longtext,
  `activity_log` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mod_phase_per_analysis` (`analysis_id`,`phase`),
  KEY `idx_mod_phase_analysis` (`analysis_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `modernization_token_usage` (
  `id` char(36) NOT NULL,
  `analysis_id` char(36) NOT NULL,
  `phase` varchar(50) NOT NULL,
  `agent` varchar(100) DEFAULT NULL,
  `model` varchar(50) DEFAULT NULL,
  `input_tokens` int NOT NULL DEFAULT '0',
  `output_tokens` int NOT NULL DEFAULT '0',
  `total_tokens` int NOT NULL DEFAULT '0',
  `estimated_cost` decimal(10,6) NOT NULL DEFAULT '0.000000',
  `duration_ms` int NOT NULL DEFAULT '0',
  `llm_calls` int NOT NULL DEFAULT '1',
  `codebase_file_count` int DEFAULT '0',
  `codebase_total_lines` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_token_analysis` (`analysis_id`),
  KEY `idx_token_phase` (`analysis_id`,`phase`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `modernization_version_changes` (
  `id` char(36) NOT NULL,
  `analysis_id` char(36) NOT NULL,
  `phase_reset` varchar(50) NOT NULL,
  `previous_selections` json DEFAULT NULL,
  `new_selections` json DEFAULT NULL,
  `previous_plan_summary` text,
  `downstream_phases_cleared` json DEFAULT NULL,
  `changed_by` varchar(36) DEFAULT NULL,
  `change_reason` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_verchange_analysis` (`analysis_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `msal_users` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `aad_object_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Azure AD Object ID (preferred unique key)',
  `user_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `home_account_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'MSAL homeAccountId',
  `tenant_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT 'Soft delete',
  PRIMARY KEY (`id`),
  UNIQUE KEY `aad_object_id` (`aad_object_id`),
  KEY `idx_aad_object_id` (`aad_object_id`),
  KEY `idx_user_email` (`user_email`),
  KEY `idx_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `navigation_edges` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `from_page_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_page_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `via_action` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Action name that triggers navigation',
  `user_role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_navigation_edge` (`from_page_id`,`to_page_id`,`via_action`,`user_role`),
  KEY `idx_from_page` (`from_page_id`),
  KEY `idx_to_page` (`to_page_id`),
  KEY `idx_user_role` (`user_role`),
  CONSTRAINT `navigation_edges_ibfk_1` FOREIGN KEY (`from_page_id`) REFERENCES `automated_test_pages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `navigation_edges_ibfk_2` FOREIGN KEY (`to_page_id`) REFERENCES `automated_test_pages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Page navigation graph for critical path and flow-based test generation';

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_read` (`user_id`,`is_read`),
  KEY `idx_notifications_tenant_user` (`tenant_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `org_integration_configs` (
  `id` char(36) NOT NULL,
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

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `organization_members` (
  `id` varchar(36) NOT NULL,
  `organization_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `role` varchar(20) NOT NULL DEFAULT 'member',
  `invited_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_org_member` (`organization_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `page_dom_elements` (
  `id` char(36) NOT NULL,
  `page_id` char(36) NOT NULL,
  `element_category` varchar(50) NOT NULL,
  `element_type` varchar(100) DEFAULT NULL,
  `xpath` varchar(2048) NOT NULL,
  `css_selector` varchar(2048) NOT NULL,
  `element_id` varchar(255) DEFAULT NULL,
  `element_name` varchar(255) DEFAULT NULL,
  `label_text` varchar(512) DEFAULT NULL,
  `is_required` tinyint(1) DEFAULT '0',
  `form_id` varchar(36) DEFAULT NULL,
  `parent_element_xpath` varchar(2048) DEFAULT NULL,
  `element_tag` varchar(64) DEFAULT NULL,
  `attributes` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_page_dom_elements_page_id` (`page_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `page_dom_versions` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `page_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_number` int NOT NULL,
  `dom_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dom_contract` json NOT NULL COMMENT 'Structured DOM contract (forms, actions, tables, etc)',
  `extracted_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Crawler/agent version',
  `extracted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_page_version` (`page_id`,`version_number`),
  UNIQUE KEY `uk_page_dom_hash` (`page_id`,`dom_hash`),
  KEY `idx_page_id` (`page_id`),
  KEY `idx_dom_hash` (`dom_hash`),
  KEY `idx_extracted_at` (`extracted_at`),
  CONSTRAINT `page_dom_versions_ibfk_1` FOREIGN KEY (`page_id`) REFERENCES `automated_test_pages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='DOM contract versions with append-only versioning for regression detection';

CREATE TABLE IF NOT EXISTS `page_forms` (
  `id` char(36) NOT NULL,
  `page_id` char(36) NOT NULL,
  `form_name` varchar(255) DEFAULT NULL,
  `form_index` int NOT NULL DEFAULT '0',
  `xpath` varchar(2048) DEFAULT NULL,
  `css_selector` varchar(2048) DEFAULT NULL,
  `action_url` varchar(2048) DEFAULT NULL,
  `method` varchar(16) DEFAULT 'GET',
  `field_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_page_forms_page_id` (`page_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `personas` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `color` text NOT NULL,
  `focus` text NOT NULL,
  `pain_points` json NOT NULL,
  `goals` json NOT NULL,
  `is_default` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `phase_confirmations` (
  `id` varchar(36) NOT NULL,
  `phase_id` varchar(36) NOT NULL,
  `confirmer_role` text NOT NULL,
  `status` text NOT NULL DEFAULT (_utf8mb4'pending'),
  `confirmer_name` text,
  `comments` text,
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `project_git_config` (
  `id` char(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `provider` enum('github','ado','gitlab','bitbucket','generic') NOT NULL DEFAULT 'ado',
  `branch` varchar(255) NOT NULL DEFAULT 'main',
  `base_path` varchar(512) DEFAULT NULL,
  `ado_repository_id` varchar(36) DEFAULT NULL,
  `ado_repository_name` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `token` text,
  `repository_url` text,
  `repository_id` varchar(255) DEFAULT NULL,
  `repository_name` varchar(255) DEFAULT NULL,
  `auth_type` enum('token','basic','none') DEFAULT 'token',
  `username` varchar(255) DEFAULT NULL,
  `base_url` varchar(512) DEFAULT NULL,
  `purpose` enum('artifact-storage','repository-access','both') NOT NULL DEFAULT 'both',
  PRIMARY KEY (`id`),
  KEY `idx_project_git_config_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `project_integration_configs` (
  `id` char(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `category_key` varchar(100) NOT NULL,
  `use_org_default` tinyint NOT NULL DEFAULT '1',
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

CREATE TABLE IF NOT EXISTS `projects` (
  `id` varchar(36) NOT NULL,
  `organization_id` varchar(36) DEFAULT NULL,
  `name` text NOT NULL,
  `description` text,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `type` varchar(50) NOT NULL DEFAULT 'development',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `devx_sdlc_project_id` varchar(255) DEFAULT NULL,
  `devx_sdlc_project_name` varchar(255) DEFAULT NULL,
  `user_id` varchar(255) DEFAULT NULL,
  `domain` text,
  `product_description` text,
  `website_url` text,
  `application_type` text,
  `ado_enabled` int DEFAULT '0',
  `ado_connection_id` varchar(255) DEFAULT NULL,
  `ado_project_id` text,
  `ado_project_name` text,
  `devx_ado_organization` varchar(255) DEFAULT NULL,
  `golden_repo_id` varchar(255) DEFAULT NULL,
  `golden_repo_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `productivity_targets` (
  `id` varchar(36) NOT NULL,
  `period_type` varchar(20) NOT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `target_saved_hours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pt_period` (`period_type`,`period_start`,`period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `prompt_logs` (
  `id` char(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `prompt` longtext NOT NULL,
  `user_request` longtext,
  `response` longtext NOT NULL,
  `model_name` varchar(255) NOT NULL,
  `tokens_consumed` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pl_user` (`user_id`),
  KEY `idx_pl_tenant` (`tenant_id`),
  KEY `idx_pl_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `prompts` (
  `id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `content` longtext NOT NULL,
  `category` varchar(100) NOT NULL DEFAULT 'General',
  `tags` json DEFAULT NULL,
  `usage_count` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `provisioning_instances` (
  `id` varchar(36) NOT NULL,
  `instance_name` varchar(255) NOT NULL,
  `status` enum('provisioning','ready','failed','deleting','deleted') NOT NULL DEFAULT 'provisioning',
  `environment` varchar(50) NOT NULL,
  `region` varchar(50) NOT NULL,
  `service_type` varchar(50) NOT NULL DEFAULT 'Web App',
  `runtime` varchar(100) DEFAULT NULL,
  `plan_tier` varchar(100) DEFAULT NULL,
  `subscription_id` varchar(36) DEFAULT NULL,
  `resource_group_name` varchar(255) DEFAULT NULL,
  `app_service_name` varchar(255) DEFAULT NULL,
  `app_service_plan_name` varchar(255) DEFAULT NULL,
  `url` varchar(500) DEFAULT NULL,
  `database_engine` varchar(50) DEFAULT NULL,
  `database_server_name` varchar(255) DEFAULT NULL,
  `database_name` varchar(255) DEFAULT NULL,
  `enable_logging` tinyint(1) DEFAULT '0',
  `auto_delete_days` int DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `error_message` text,
  `provisioning_started_at` timestamp NULL DEFAULT NULL,
  `provisioning_completed_at` timestamp NULL DEFAULT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_provisioning_instances_user_id` (`user_id`),
  KEY `idx_provisioning_instances_status` (`status`),
  KEY `idx_provisioning_instances_instance_name` (`instance_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `rag_sessions` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `session_type` varchar(50) NOT NULL DEFAULT 'artifact_generation',
  `status` varchar(50) NOT NULL DEFAULT 'processing',
  `requirement_ids` json DEFAULT NULL,
  `guideline_ids` json DEFAULT NULL,
  `cache_hit_count` int NOT NULL DEFAULT '0',
  `cache_miss_count` int NOT NULL DEFAULT '0',
  `total_processing_time_ms` int DEFAULT NULL,
  `rag_processing_time_ms` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_session_type` (`session_type`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Tracks RAG processing sessions for analytics and debugging';

CREATE TABLE IF NOT EXISTS `report_validations` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `user_id` varchar(255) NOT NULL,
  `source_filename` text NOT NULL,
  `target_filename` text NOT NULL,
  `source_file_type` text NOT NULL,
  `target_file_type` text NOT NULL,
  `status` text NOT NULL,
  `result` text,
  `match_percentage` int DEFAULT NULL,
  `config` json DEFAULT NULL,
  `summary` json DEFAULT NULL,
  `ai_analysis` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `requirements` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `responsive_test_results` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `url` text NOT NULL,
  `status` text NOT NULL,
  `overall_score` int DEFAULT NULL,
  `devices_tested_count` int DEFAULT '0',
  `passed_devices_count` int DEFAULT '0',
  `failed_devices_count` int DEFAULT '0',
  `device_results` json DEFAULT NULL,
  `layout_issues` json DEFAULT NULL,
  `touch_target_issues` json DEFAULT NULL,
  `performance_metrics` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `role_activity_permissions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `provider` varchar(50) NOT NULL,
  `role_id` int NOT NULL,
  `activity_key` varchar(150) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_activity` (`tenant_id`,`provider`,`role_id`,`activity_key`),
  KEY `fk_role_activity_role` (`role_id`),
  CONSTRAINT `fk_role_activity_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `migration_name` varchar(255) NOT NULL,
  `description` text,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_time_ms` int DEFAULT NULL,
  `status` enum('success','failed','rolled_back') DEFAULT 'success',
  `error_message` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `migration_name` (`migration_name`),
  KEY `idx_migration_name` (`migration_name`),
  KEY `idx_executed_at` (`executed_at`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_backlog_items` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `type` text NOT NULL DEFAULT (_utf8mb4'story'),
  `story_points` int DEFAULT NULL,
  `priority` text NOT NULL DEFAULT (_utf8mb4'medium'),
  `status` text NOT NULL DEFAULT (_utf8mb4'backlog'),
  `assigned_to` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `epic_id` varchar(36) DEFAULT NULL,
  `figma_link` text,
  `persona` text,
  `persona_id` varchar(36) DEFAULT NULL,
  `acceptance_criteria` json DEFAULT NULL,
  `subtasks` json DEFAULT NULL,
  `source` varchar(50) DEFAULT 'manual',
  `workflow_session_id` varchar(36) DEFAULT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `requirement_id` varchar(36) DEFAULT NULL,
  `feature_id` varchar(36) DEFAULT NULL,
  `jira_issue_id` varchar(100) DEFAULT NULL,
  `jira_pushed_at` timestamp NULL DEFAULT NULL,
  `jira_synced_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_code` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `content` longtext NOT NULL,
  `language` text NOT NULL DEFAULT (_utf8mb4'typescript'),
  `file_name` text,
  `file_path` text,
  `generated_from` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_commits` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `message` text NOT NULL,
  `commit_number` int NOT NULL DEFAULT '1',
  `author` text NOT NULL DEFAULT (_utf8mb4'System'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_design_assets` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `file_url` longtext NOT NULL,
  `file_type` text NOT NULL,
  `file_size` int DEFAULT NULL,
  `thumbnail_url` longtext,
  `uploaded_by` text,
  `source` text DEFAULT (_utf8mb4'manual'),
  `source_document_id` varchar(36) DEFAULT NULL,
  `design_category` text,
  `ado_work_item_id` int DEFAULT NULL,
  `ado_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_design_reviews` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `design_asset_id` varchar(36) DEFAULT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` text NOT NULL DEFAULT (_utf8mb4'pending'),
  `reviewed_by` text,
  `comments` text,
  `review_date` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_documents` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `content` longtext,
  `type` text NOT NULL DEFAULT (_utf8mb4'general'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_epics` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` text NOT NULL DEFAULT (_utf8mb4'planned'),
  `priority` text NOT NULL DEFAULT (_utf8mb4'medium'),
  `feature_count` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_figma_links` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `figma_url` text NOT NULL,
  `access_level` text NOT NULL DEFAULT (_utf8mb4'view'),
  `created_by` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_issues` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` text NOT NULL DEFAULT (_utf8mb4'open'),
  `priority` text NOT NULL DEFAULT (_utf8mb4'medium'),
  `assigned_to` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_phases` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `phase_name` text NOT NULL,
  `status` text NOT NULL DEFAULT (_utf8mb4'not_started'),
  `progress` int NOT NULL DEFAULT '0',
  `notes` text,
  `assigned_to` text,
  `deliverables` text,
  `start_date` timestamp NULL DEFAULT NULL,
  `end_date` timestamp NULL DEFAULT NULL,
  `completed_date` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_previews` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `status` text NOT NULL DEFAULT (_utf8mb4'active'),
  `preview_url` text,
  `code_status` text NOT NULL DEFAULT (_utf8mb4'generated'),
  `commit_count` int NOT NULL DEFAULT '1',
  `last_commit_message` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_project_tool_configs` (
  `id` varchar(36) NOT NULL,
  `sdlc_project_id` varchar(36) NOT NULL,
  `category` enum('repo','cicd') NOT NULL,
  `provider` varchar(50) NOT NULL,
  `base_url` text NOT NULL,
  `gitlab_project_id` varchar(512) NOT NULL,
  `namespace_path` text,
  `token_encrypted` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sdlc_project_tool_configs_project_category` (`sdlc_project_id`,`category`),
  CONSTRAINT `fk_sdlc_project_tool_configs_project` FOREIGN KEY (`sdlc_project_id`) REFERENCES `sdlc_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_projects` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `organization` text,
  `repository_id` varchar(36) DEFAULT NULL,
  `repository_count` int DEFAULT '0',
  `cloud_provider` text,
  `status` text NOT NULL DEFAULT (_utf8mb4'active'),
  `deleted_from_ado` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `project_id` varchar(255) DEFAULT NULL,
  `ado_project_url` text,
  `linked_golden_repo_org` text,
  `linked_golden_repo_project` text,
  `linked_golden_repo_name` text,
  `golden_repo_reference` json DEFAULT NULL,
  `enable_tdd` tinyint(1) DEFAULT '0',
  `is_generating` tinyint(1) DEFAULT '0',
  `integration_type` varchar(50) DEFAULT 'ado',
  `jira_connection_id` varchar(36) DEFAULT NULL,
  `jira_instance_url` text,
  `jira_project_key` varchar(100) DEFAULT NULL,
  `specs_architecture_style` varchar(50) DEFAULT NULL,
  `specs_delivery_order` text,
  `work_items_available` json DEFAULT NULL,
  `application_type` varchar(50) DEFAULT 'unknown',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_requirements` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `type` text NOT NULL DEFAULT (_utf8mb4'functional'),
  `priority` text NOT NULL DEFAULT (_utf8mb4'medium'),
  `status` text NOT NULL DEFAULT (_utf8mb4'draft'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_settings` (
  `id` varchar(36) NOT NULL,
  `phase_unlock_threshold` text DEFAULT (_utf8mb4'80'),
  `enable_auto_phase_unlock` text DEFAULT (_utf8mb4'true'),
  `require_phase_approvals` text DEFAULT (_utf8mb4'false'),
  `default_assignee` text,
  `enable_notifications` text DEFAULT (_utf8mb4'true'),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_specs_files` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `project_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `feature_id` int NOT NULL,
  `feature_title` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `path` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `pushed_to_ado_at` timestamp NULL DEFAULT NULL,
  `pushed_to_ado` tinyint(1) NOT NULL DEFAULT '0',
  `content_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `repo_commit_id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_stories_json` json DEFAULT NULL,
  `input_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `spec_version` int DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_sdlc_specs_files_project` (`project_id`),
  KEY `idx_sdlc_specs_files_feature` (`feature_id`),
  KEY `idx_sdlc_specs_files_type` (`file_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `security_scan_configs` (
  `id` char(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `dast_target_url` varchar(2048) DEFAULT NULL,
  `dast_mode` enum('safe','aggressive') NOT NULL DEFAULT 'safe',
  `auth_type` enum('none','bearer','basic','headers') NOT NULL DEFAULT 'none',
  `auth_config` json DEFAULT NULL,
  `enabled_scanners` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_security_scan_configs_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `security_scan_jobs` (
  `id` char(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `project_name` varchar(255) NOT NULL,
  `requested_by_user_id` varchar(36) DEFAULT NULL,
  `requested_by_name` varchar(255) DEFAULT NULL,
  `organization` varchar(255) DEFAULT NULL,
  `target_project_name` varchar(255) DEFAULT NULL,
  `status` enum('queued','in_progress','completed','failed') NOT NULL DEFAULT 'queued',
  `progress` int NOT NULL DEFAULT '0',
  `current_step` varchar(255) NOT NULL DEFAULT 'Queued',
  `session_data` json DEFAULT NULL,
  `error_details` json DEFAULT NULL,
  `progress_log` json DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_security_scan_jobs_project_id` (`project_id`),
  KEY `idx_security_scan_jobs_status` (`status`),
  KEY `idx_security_scan_jobs_project_created` (`project_id`,`created_at`),
  KEY `idx_security_scan_jobs_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `session_cost_summaries` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `total_cost` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `total_input_tokens` bigint NOT NULL DEFAULT '0',
  `total_output_tokens` bigint NOT NULL DEFAULT '0',
  `total_calls` int NOT NULL DEFAULT '0',
  `last_calculated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_id` (`session_id`),
  KEY `idx_session_id` (`session_id`),
  CONSTRAINT `fk_session_cost_summaries_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_states` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `state_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'JSON string of complete session state',
  `cursor_state` json DEFAULT NULL COMMENT 'Cursor/UI state',
  `inputs` json DEFAULT NULL COMMENT 'User inputs at time of save',
  `outputs` json DEFAULT NULL COMMENT 'AI outputs at time of save',
  `version` int NOT NULL DEFAULT '1' COMMENT 'Version number for optimistic locking',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_session_state` (`session_id`),
  KEY `idx_session_id` (`session_id`),
  CONSTRAINT `fk_session_states_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `specs_generation_jobs` (
  `id` char(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `project_name` varchar(255) NOT NULL,
  `requested_by_user_id` varchar(36) DEFAULT NULL,
  `requested_by_name` varchar(255) DEFAULT NULL,
  `status` enum('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
  `progress` int NOT NULL DEFAULT '0',
  `current_step` varchar(255) NOT NULL DEFAULT 'Queued',
  `payload_json` json DEFAULT NULL,
  `result_json` json DEFAULT NULL,
  `error_message` text,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_specs_generation_jobs_project_id` (`project_id`),
  KEY `idx_specs_generation_jobs_status` (`status`),
  KEY `idx_specs_generation_jobs_status_created_at` (`status`,`created_at`),
  KEY `idx_specs_generation_jobs_project_id_created_at` (`project_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sprint_test_cases` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `sprint_id` varchar(255) DEFAULT NULL,
  `sprint_user_story_id` varchar(255) DEFAULT NULL,
  `user_story_id` varchar(255) DEFAULT NULL,
  `test_case_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `objective` text,
  `preconditions` json DEFAULT NULL,
  `test_steps` json NOT NULL,
  `expected_result` text,
  `postconditions` json DEFAULT NULL,
  `test_data` json DEFAULT NULL,
  `test_type` text,
  `category` text NOT NULL,
  `priority` text,
  `status` text,
  `edit_status` text,
  `is_edited` int DEFAULT '0',
  `linked_acceptance_criteria` json DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `notes` text,
  `original_version` json DEFAULT NULL,
  `change_history` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sprint_user_stories` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `sprint_id` varchar(255) NOT NULL,
  `ado_work_item_id` int DEFAULT NULL,
  `title` text NOT NULL,
  `description` text,
  `acceptance_criteria` text,
  `story_points` int DEFAULT NULL,
  `priority` text,
  `status` text,
  `source` text,
  `assigned_to` text,
  `tags` json DEFAULT NULL,
  `ado_url` text,
  `ado_sync_status` text,
  `ado_last_sync_at` timestamp NULL DEFAULT NULL,
  `attachments` json DEFAULT NULL,
  `additional_context` text,
  `context_documents` json DEFAULT NULL,
  `context_urls` json DEFAULT NULL,
  `generated_test_cases` json DEFAULT NULL,
  `test_case_count` int DEFAULT '0',
  `generated_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sprints` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `project_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `goal` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `status` enum('upcoming','active','completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'upcoming',
  `type` enum('general','design') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'general',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `description` text COLLATE utf8mb4_unicode_ci,
  `ado_sync_enabled` int DEFAULT '0',
  `ado_backlog_source` text COLLATE utf8mb4_unicode_ci,
  `ado_iteration_path` text COLLATE utf8mb4_unicode_ci,
  `ado_area_path` text COLLATE utf8mb4_unicode_ci,
  `ado_wiql_query` text COLLATE utf8mb4_unicode_ci,
  `ado_work_item_types` json DEFAULT NULL,
  `ado_sync_frequency` text COLLATE utf8mb4_unicode_ci,
  `ado_last_sync_at` timestamp NULL DEFAULT NULL,
  `ado_sync_status` text COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_status` (`status`),
  KEY `idx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subscription_types` (
  `id` char(36) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` char(36) NOT NULL,
  `tenant_id` char(36) NOT NULL,
  `subscription_type_id` char(36) NOT NULL,
  `max_users` int NOT NULL,
  `token_quota` bigint NOT NULL DEFAULT '0',
  `token_used` bigint NOT NULL DEFAULT '0',
  `start_date` date NOT NULL,
  `expiry_date` date NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_subscription_type` (`subscription_type_id`),
  KEY `idx_subscriptions_tenant` (`tenant_id`),
  CONSTRAINT `fk_subscription_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_subscription_type` FOREIGN KEY (`subscription_type_id`) REFERENCES `subscription_types` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `synthetic_data_jobs` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `user_id` varchar(255) NOT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `domain` text NOT NULL,
  `sub_domain` text NOT NULL,
  `record_count` int NOT NULL DEFAULT '100',
  `data_prefix` text,
  `masking_enabled` int NOT NULL DEFAULT '0',
  `selected_fields` json DEFAULT NULL,
  `generated_data` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `status` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `tenant_description` text,
  `vertical` varchar(100) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `log_retention_days` int DEFAULT '90',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_cases` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `workflow_id` varchar(255) NOT NULL,
  `test_id` text NOT NULL,
  `name` text NOT NULL,
  `objective` text NOT NULL,
  `given` text NOT NULL,
  `when` text NOT NULL,
  `then` text NOT NULL,
  `selector` text,
  `preconditions` json DEFAULT NULL,
  `test_steps` json NOT NULL,
  `postconditions` json DEFAULT NULL,
  `test_data` json DEFAULT NULL,
  `test_type` text NOT NULL,
  `status` text NOT NULL,
  `priority` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_plan_documents` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_plan_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `brd_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `brd_title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `organization_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ado_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ado_org` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ado_project` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_test_plan_brd_id` (`brd_id`),
  KEY `idx_test_plan_project_id` (`project_id`),
  KEY `idx_test_plan_organization_id` (`organization_id`),
  KEY `idx_test_plan_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `test_results` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `session_id` varchar(255) NOT NULL,
  `completion_time` int NOT NULL,
  `design_compliance` int NOT NULL,
  `accessibility_warnings` int NOT NULL,
  `test_cases_generated` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_sessions` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `figma_url` text NOT NULL,
  `website_url` text NOT NULL,
  `test_scope` text NOT NULL,
  `browser_target` text NOT NULL,
  `status` text NOT NULL,
  `tasks` json DEFAULT NULL,
  `metrics` json DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `token_usage_logs` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tokens_consumed` bigint NOT NULL,
  `model_name` varchar(100) NOT NULL DEFAULT 'BRD_STANDARD_COST',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_token_usage_logs_tenant_id` (`tenant_id`),
  KEY `idx_token_usage_logs_user_id` (`user_id`),
  KEY `idx_token_usage_logs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `universal_ai_usage_logs` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `team_id` varchar(100) DEFAULT NULL,
  `project_id` varchar(100) DEFAULT NULL,
  `session_id` varchar(36) DEFAULT NULL,
  `correlation_id` varchar(36) DEFAULT NULL,
  `provider` varchar(50) NOT NULL DEFAULT 'claude',
  `model_name` varchar(255) NOT NULL,
  `feature_name` varchar(100) DEFAULT NULL,
  `use_case` varchar(100) DEFAULT NULL,
  `request_status` varchar(20) NOT NULL DEFAULT 'success',
  `quality_decision` varchar(20) NOT NULL DEFAULT 'unrated',
  `input_tokens` int NOT NULL DEFAULT '0',
  `output_tokens` int NOT NULL DEFAULT '0',
  `cache_tokens` int NOT NULL DEFAULT '0',
  `total_tokens` int NOT NULL DEFAULT '0',
  `cost_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `currency` varchar(3) NOT NULL DEFAULT 'USD',
  `latency_ms` int DEFAULT NULL,
  `request_metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_uaiul_user_created` (`user_id`,`created_at`),
  KEY `idx_uaiul_provider_created` (`provider`,`created_at`),
  KEY `idx_uaiul_usecase_created` (`use_case`,`created_at`),
  KEY `idx_uaiul_created` (`created_at`),
  KEY `idx_uaiul_quality` (`quality_decision`),
  KEY `idx_uaiul_correlation` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_activity_logs` (
  `id` char(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `action_type` enum('API_MUTATION','UI_ACTION','PAGE_VIEW') NOT NULL,
  `action` varchar(255) NOT NULL,
  `method` varchar(10) DEFAULT NULL,
  `path` varchar(500) DEFAULT NULL,
  `payload` json DEFAULT NULL,
  `response_status` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ual_user` (`user_id`),
  KEY `idx_ual_tenant` (`tenant_id`),
  KEY `idx_ual_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_git_credentials` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `provider` varchar(20) NOT NULL,
  `base_url` varchar(500) NOT NULL,
  `token_encrypted` text NOT NULL,
  `external_user_id` varchar(100) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_git` (`user_id`,`provider`,`base_url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_gitlab_credentials` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `base_url` varchar(500) NOT NULL DEFAULT 'https://gitlab.com',
  `token_encrypted` text NOT NULL,
  `gitlab_user_id` varchar(100) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_gitlab` (`user_id`,`base_url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_jira_credentials` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `instance_url` varchar(500) NOT NULL,
  `email` varchar(255) NOT NULL,
  `api_token_encrypted` text NOT NULL,
  `account_id` varchar(100) DEFAULT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_instance` (`user_id`,`instance_url`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_project_integration_credentials` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `integration_kind` varchar(50) NOT NULL,
  `integration_id` varchar(100) NOT NULL,
  `provider_key` varchar(100) DEFAULT NULL,
  `last_test_status` varchar(20) DEFAULT 'untested',
  `last_test_message` text,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_user_project_integration_credentials` (`user_id`,`project_id`,`integration_kind`,`integration_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_project_repo_credentials` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `provider` varchar(20) NOT NULL,
  `base_url` varchar(500) NOT NULL,
  `token_encrypted` text NOT NULL,
  `external_user_id` varchar(100) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_project_repo` (`user_id`,`project_id`,`provider`,`base_url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `project_members` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `role` varchar(20) NOT NULL DEFAULT 'member',
  `invited_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_project_member` (`project_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `tenant_id` varchar(255) DEFAULT NULL,
  `provider` varchar(50) NOT NULL DEFAULT 'microsoft',
  `role_id` int NOT NULL,
  `scope_type` enum('org','project') NOT NULL,
  `scope_id` varchar(500) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_role_scope` (`user_id`,`role_id`,`scope_type`,`scope_id`),
  KEY `fk_user_roles_role` (`role_id`),
  KEY `idx_user_roles_provider` (`provider`),
  CONSTRAINT `fk_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_seats` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `seat_assigned` tinyint(1) DEFAULT '0',
  `seat_assigned_by` varchar(36) DEFAULT NULL,
  `seat_assigned_at` timestamp NULL DEFAULT NULL,
  `seat_revoked_at` timestamp NULL DEFAULT NULL,
  `seat_revoked_by` varchar(36) DEFAULT NULL,
  `role` varchar(50) DEFAULT NULL,
  `feature_access` json DEFAULT NULL,
  `last_active` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_stories` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `requirement_id` varchar(255) NOT NULL,
  `ado_work_item_id` int DEFAULT NULL,
  `title` text NOT NULL,
  `description` text,
  `acceptance_criteria` text,
  `state` text,
  `assigned_to` text,
  `sprint` text,
  `area_path` text,
  `tags` json DEFAULT NULL,
  `ado_url` text,
  `synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ado_work_item_id` (`ado_work_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` char(36) NOT NULL,
  `azure_oid` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` char(36) DEFAULT NULL,
  `provider` varchar(50) NOT NULL DEFAULT 'azure',
  `provider_user_id` varchar(100) NOT NULL,
  `token_quota` int NOT NULL DEFAULT '0',
  `token_used` int NOT NULL DEFAULT '0',
  `mfa_secret` varchar(255) DEFAULT NULL,
  `is_mfa_enabled` tinyint(1) DEFAULT '0',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Soft-delete flag: 1 = deleted, 0 = active',
  `deleted_at` datetime DEFAULT NULL COMMENT 'Timestamp when the user was soft-deleted',
  `username` text NOT NULL,
  `password` text NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `azure_oid` (`azure_oid`),
  KEY `fk_users_tenant` (`tenant_id`),
  CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `validation_results` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `validation_id` varchar(255) NOT NULL,
  `row_number` int DEFAULT NULL,
  `column_name` text,
  `sheet_name` text,
  `source_value` text,
  `target_value` text,
  `difference` text,
  `percent_diff` text,
  `match_status` text NOT NULL,
  `ai_analysis` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `vectorized_guidelines` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(36) NOT NULL,
  `guideline_name` varchar(500) NOT NULL,
  `content_hash` varchar(64) NOT NULL,
  `qdrant_collection` varchar(255) NOT NULL,
  `chunk_count` int NOT NULL DEFAULT '0',
  `embedding_model` varchar(100) NOT NULL DEFAULT 'text-embedding-ada-002',
  `status` varchar(50) NOT NULL DEFAULT 'processing',
  `processing_time_ms` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `content_hash` (`content_hash`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_content_hash` (`content_hash`),
  KEY `idx_status` (`status`),
  KEY `idx_project_status` (`project_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Stores metadata about vectorized guidelines for RAG caching';

CREATE TABLE IF NOT EXISTS `visual_diffs` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `result_id` varchar(255) NOT NULL,
  `area` text NOT NULL,
  `count` int NOT NULL,
  `severity` text NOT NULL,
  `screenshot_url` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `visual_regression_baselines` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `project_id` varchar(255) DEFAULT NULL,
  `name` text NOT NULL,
  `url` text NOT NULL,
  `viewport` text NOT NULL,
  `viewport_width` int DEFAULT '1920',
  `viewport_height` int DEFAULT '1080',
  `baseline_image_url` text,
  `baseline_image_data` text,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `visual_regression_results` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `baseline_id` varchar(255) DEFAULT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `status` text NOT NULL,
  `diff_percentage` int DEFAULT NULL,
  `ssim_score` int DEFAULT NULL,
  `psnr_score` int DEFAULT NULL,
  `mse_score` int DEFAULT NULL,
  `pixels_different` int DEFAULT NULL,
  `total_pixels` int DEFAULT NULL,
  `current_image_data` text,
  `diff_image_data` text,
  `differences` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `wiki_pages` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `session_id` varchar(36) DEFAULT NULL,
  `page_type` text NOT NULL,
  `phase` varchar(50) NOT NULL DEFAULT 'reference',
  `title` text NOT NULL,
  `content` longtext NOT NULL,
  `order` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `confluence_page_id` varchar(64) DEFAULT NULL COMMENT 'Confluence content ID after push; used to PUT updates when editing in DevX',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_artifacts` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `project_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requirement` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `guidelines` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `epics` json NOT NULL,
  `features` json NOT NULL,
  `user_stories` json NOT NULL,
  `personas` json NOT NULL,
  `wiki_pages` json NOT NULL,
  `figma_guidelines` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `modified` tinyint(1) DEFAULT '0',
  `approval_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_count` int DEFAULT '0',
  `total_count` int DEFAULT '0',
  `modified_items` json NOT NULL DEFAULT (_utf8mb4'{"epics":[],"features":[],"userStories":[]}'),
  `brd_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Link to BRD document (optional)',
  `requirement_ids` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflow_attached_documents` (
  `chat_session_id` char(36) NOT NULL,
  `file_ID` char(36) NOT NULL,
  `message_ID` char(36) DEFAULT NULL,
  `file_name` varchar(1024) NOT NULL,
  `file_Type` varchar(128) NOT NULL,
  `use_Case` varchar(128) NOT NULL,
  `file_url` varchar(2048) NOT NULL,
  `extracted_text` mediumtext,
  `Checksum` varchar(128) DEFAULT NULL,
  `last_scanned_at` bigint unsigned DEFAULT NULL,
  `uploaded_time` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  `uploaded_by` char(36) NOT NULL,
  PRIMARY KEY (`file_ID`),
  KEY `idx_files_session` (`chat_session_id`),
  KEY `idx_files_message` (`message_ID`),
  CONSTRAINT `fk_files_message` FOREIGN KEY (`message_ID`) REFERENCES `workflow_conversation_messages` (`message_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_files_session` FOREIGN KEY (`chat_session_id`) REFERENCES `workflow_conversation_titles` (`chat_session_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_brd_attachments` (
  `id` char(36) NOT NULL,
  `workflow_id` char(36) NOT NULL,
  `brd_version_id` bigint NOT NULL,
  `attached_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `attached_by` char(36) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_conversation_messages` (
  `chat_session_id` char(36) NOT NULL,
  `message_id` char(36) NOT NULL,
  `message_created_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  `role` enum('user','assistant','system','tool') NOT NULL DEFAULT 'user',
  `message_content` mediumtext NOT NULL,
  `message_type` enum('text','command','attachment_ref','metadata') NOT NULL DEFAULT 'text',
  `document_attached` tinyint(1) NOT NULL DEFAULT '0',
  `is_summarized` tinyint(1) NOT NULL DEFAULT '0',
  `chat_model` varchar(128) DEFAULT NULL,
  `deleted_at` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`message_id`),
  KEY `idx_messages_session_created` (`chat_session_id`,`message_created_at`),
  CONSTRAINT `fk_messages_session` FOREIGN KEY (`chat_session_id`) REFERENCES `workflow_conversation_titles` (`chat_session_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_conversation_titles` (
  `chat_session_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `chat_model` varchar(128) NOT NULL,
  `selected_organization` varchar(255) DEFAULT NULL,
  `selected_project` varchar(255) DEFAULT NULL,
  `conversation_title` varchar(512) NOT NULL,
  `created_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  `updated_at` bigint unsigned NOT NULL DEFAULT (unix_timestamp()),
  `deleted_at` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`chat_session_id`),
  KEY `idx_titles_org_proj_updated` (`selected_organization`,`selected_project`,`updated_at`),
  KEY `idx_titles_user_updated` (`user_id`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_settings` (
  `id` varchar(36) NOT NULL,
  `repository_name` text,
  `project_name` text,
  `organization_url` text,
  `pat_token` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_step1_data` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `conversation_history` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of conversation messages',
  `captured_requirements` json NOT NULL DEFAULT (json_object()) COMMENT 'Captured requirements object',
  `current_phase` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'understanding' COMMENT 'understanding, refining, personas, artifacts, complete',
  `asked_questions` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of asked questions',
  `requirement` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Final requirement text',
  `is_ready_to_generate` tinyint(1) DEFAULT '0',
  `compliance_guidelines` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of compliance guidelines',
  `selected_persona_ids` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of selected persona IDs',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_id` (`session_id`),
  UNIQUE KEY `unique_step1_session` (`session_id`),
  KEY `idx_session_id` (`session_id`),
  CONSTRAINT `fk_workflow_step1_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflow_step2_data` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `epics` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of epics',
  `features` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of features',
  `user_stories` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of user stories',
  `personas` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of personas',
  `guidelines` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Design guidelines',
  `figma_guidelines` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Figma guidelines',
  `wiki_pages` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of wiki pages',
  `subtasks` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of subtasks',
  `test_cases` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of test cases',
  `generation_metadata` json DEFAULT NULL COMMENT 'Metadata about generation (model, provider, etc.)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `quality_report` json DEFAULT NULL,
  `domain_expert_analysis` json DEFAULT NULL,
  `generation_logs` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_id` (`session_id`),
  UNIQUE KEY `unique_step2_session` (`session_id`),
  KEY `idx_session_id` (`session_id`),
  CONSTRAINT `fk_workflow_step2_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflow_step3_data` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `azure_config` json DEFAULT NULL COMMENT 'Azure DevOps configuration',
  `pushed_items` json NOT NULL DEFAULT (json_object()) COMMENT 'Items pushed to ADO',
  `push_status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'not_started' COMMENT 'not_started, in_progress, completed, failed',
  `push_errors` json NOT NULL DEFAULT (json_array()) COMMENT 'Array of push errors',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_id` (`session_id`),
  UNIQUE KEY `unique_step3_session` (`session_id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_push_status` (`push_status`),
  CONSTRAINT `fk_workflow_step3_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflow_steps` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FK to ai_sessions.id',
  `step_number` int NOT NULL COMMENT '1, 2, 3, etc.',
  `step_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g., conversational_refinement, artifact_generation, devops_push',
  `status` enum('NOT_STARTED','IN_PROGRESS','COMPLETED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NOT_STARTED',
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_session_step` (`session_id`,`step_number`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_step_number` (`step_number`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_workflow_steps_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflow_subtasks` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `artifact_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_story_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `estimated_hours` int DEFAULT '0',
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `assigned_to` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_artifact_id` (`artifact_id`),
  KEY `idx_user_story_id` (`user_story_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `workflow_subtasks_ibfk_1` FOREIGN KEY (`artifact_id`) REFERENCES `workflow_artifacts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflow_test_cases` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `artifact_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_story_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_case_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g., TC-001',
  `title` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `preconditions` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `test_steps` json NOT NULL DEFAULT (_utf8mb4'[]'),
  `expected_result` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Functional, Integration, Regression',
  `ado_work_item_id` int DEFAULT NULL COMMENT 'Azure DevOps Test Case work item ID',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_artifact_id` (`artifact_id`),
  KEY `idx_user_story_id` (`user_story_id`),
  KEY `idx_test_case_id` (`test_case_id`),
  CONSTRAINT `fk_test_cases_artifact` FOREIGN KEY (`artifact_id`) REFERENCES `workflow_artifacts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `workflows` (
  `id` varchar(255) NOT NULL DEFAULT (uuid()),
  `session_id` varchar(255) NOT NULL,
  `workflow_id` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `entry_point` text NOT NULL,
  `steps` json NOT NULL,
  `confidence` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

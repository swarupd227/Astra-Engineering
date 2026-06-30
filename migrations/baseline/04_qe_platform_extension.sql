-- =============================================================================
-- QE / test automation + platform extension tables
-- Source: shared/qe-schema.ts + shared/schema.ts (tables not in 01_schema_new1)
-- Idempotent: CREATE TABLE IF NOT EXISTS
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Prompt library (also ensured at runtime in server/db.ts)
CREATE TABLE IF NOT EXISTS `prompts` (
  `id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `content` longtext NOT NULL,
  `category` varchar(100) NOT NULL DEFAULT 'General',
  `tags` json DEFAULT NULL,
  `usage_count` int DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `functional_test_sessions` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `url` text NOT NULL,
  `test_focus` text NOT NULL,
  `crawl_status` text NOT NULL DEFAULT 'pending',
  `pages_visited` int DEFAULT 0,
  `workflows_discovered` int DEFAULT 0,
  `test_cases_generated` int DEFAULT 0,
  `test_cases_passed` int DEFAULT 0,
  `test_cases_failed` int DEFAULT 0,
  `crawl_progress` json DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fts_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflows` (
  `id` varchar(255) NOT NULL,
  `session_id` varchar(255) NOT NULL,
  `workflow_id` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `entry_point` text NOT NULL,
  `steps` json NOT NULL,
  `confidence` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_workflows_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_cases` (
  `id` varchar(255) NOT NULL,
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
  `test_type` text NOT NULL DEFAULT 'Functional',
  `status` text NOT NULL DEFAULT 'pending',
  `priority` text DEFAULT 'P2',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_test_cases_workflow` (`workflow_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `execution_results` (
  `id` varchar(255) NOT NULL,
  `test_case_id` varchar(255) NOT NULL,
  `status` text NOT NULL,
  `execution_time` int NOT NULL,
  `screenshot_url` text,
  `error_log` text,
  `console_errors` json DEFAULT NULL,
  `network_errors` json DEFAULT NULL,
  `actual_result` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_execution_results_case` (`test_case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_sessions` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `figma_url` text NOT NULL,
  `website_url` text NOT NULL,
  `test_scope` text NOT NULL,
  `browser_target` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `tasks` json DEFAULT NULL,
  `metrics` json DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_results` (
  `id` varchar(255) NOT NULL,
  `session_id` varchar(255) NOT NULL,
  `completion_time` int NOT NULL,
  `design_compliance` int NOT NULL,
  `accessibility_warnings` int NOT NULL,
  `test_cases_generated` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_test_results_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `visual_diffs` (
  `id` varchar(255) NOT NULL,
  `result_id` varchar(255) NOT NULL,
  `area` text NOT NULL,
  `count` int NOT NULL,
  `severity` text NOT NULL,
  `screenshot_url` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_visual_diffs_result` (`result_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_runs` (
  `id` varchar(255) NOT NULL,
  `url` text NOT NULL,
  `status` text NOT NULL DEFAULT 'crawling',
  `page_count` int DEFAULT 0,
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_pages` (
  `id` varchar(255) NOT NULL,
  `run_id` varchar(255) NOT NULL,
  `url` text NOT NULL,
  `title` text,
  `forms` int DEFAULT 0,
  `buttons` int DEFAULT 0,
  `inputs` int DEFAULT 0,
  `links` int DEFAULT 0,
  `dom_data` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auto_test_pages_run` (`run_id`)
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
  PRIMARY KEY (`id`),
  KEY `idx_auto_test_cases_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_scripts` (
  `id` varchar(255) NOT NULL,
  `case_id` varchar(255) NOT NULL,
  `framework` text NOT NULL DEFAULT 'playwright',
  `language` text NOT NULL DEFAULT 'typescript',
  `content` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auto_test_scripts_case` (`case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `auto_test_executions` (
  `id` varchar(255) NOT NULL,
  `script_id` varchar(255) NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `result` json DEFAULT NULL,
  `error_message` text,
  `duration_ms` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_auto_test_executions_script` (`script_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `requirements` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_requirements_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_stories` (
  `id` varchar(255) NOT NULL,
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
  UNIQUE KEY `user_stories_ado_work_item_id` (`ado_work_item_id`),
  KEY `idx_user_stories_requirement` (`requirement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sprint_user_stories` (
  `id` varchar(255) NOT NULL,
  `sprint_id` varchar(255) NOT NULL,
  `ado_work_item_id` int DEFAULT NULL,
  `title` text NOT NULL,
  `description` text,
  `acceptance_criteria` text,
  `story_points` int DEFAULT NULL,
  `priority` text DEFAULT 'medium',
  `status` text DEFAULT 'new',
  `assigned_to` text,
  `tags` json DEFAULT NULL,
  `ado_url` text,
  `synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sprint_user_stories_sprint` (`sprint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sprint_test_cases` (
  `id` varchar(255) NOT NULL,
  `sprint_id` varchar(255) NOT NULL,
  `story_id` varchar(255) DEFAULT NULL,
  `test_id` text NOT NULL,
  `name` text NOT NULL,
  `objective` text,
  `given` text,
  `when` text,
  `then` text,
  `test_steps` json DEFAULT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `priority` text DEFAULT 'P2',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sprint_test_cases_sprint` (`sprint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `functional_test_runs` (
  `id` varchar(255) NOT NULL,
  `session_id` varchar(255) NOT NULL,
  `run_name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `total_cases` int DEFAULT 0,
  `passed_cases` int DEFAULT 0,
  `failed_cases` int DEFAULT 0,
  `functional_cases` int DEFAULT 0,
  `negative_cases` int DEFAULT 0,
  `edge_cases` int DEFAULT 0,
  `text_validation_cases` int DEFAULT 0,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_functional_test_runs_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `functional_test_run_cases` (
  `id` varchar(255) NOT NULL,
  `run_id` varchar(255) NOT NULL,
  `test_case_id` varchar(255) NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `result` json DEFAULT NULL,
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ft_run_cases_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `integration_configs` (
  `id` varchar(255) NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `platform` text NOT NULL,
  `name` text NOT NULL,
  `config` json NOT NULL,
  `status` text NOT NULL DEFAULT 'not_configured',
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `last_error` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_integration_configs_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ado_configurations` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `organization_url` text NOT NULL,
  `project_name` text NOT NULL,
  `pat_token` text,
  `api_version` text DEFAULT '7.0',
  `config` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ado_configurations_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `execution_runs` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `run_name` text NOT NULL,
  `browser` text NOT NULL DEFAULT 'chromium',
  `execution_mode` text NOT NULL DEFAULT 'headless',
  `status` text NOT NULL DEFAULT 'pending',
  `total_tests` int NOT NULL DEFAULT 0,
  `passed_tests` int DEFAULT 0,
  `failed_tests` int DEFAULT 0,
  `skipped_tests` int DEFAULT 0,
  `duration` int DEFAULT 0,
  `video_path` text,
  `agent_logs` json DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `execution_run_tests` (
  `id` varchar(255) NOT NULL,
  `run_id` varchar(255) NOT NULL,
  `test_case_id` varchar(255) NOT NULL,
  `test_case_source` text NOT NULL DEFAULT 'functional',
  `test_name` text NOT NULL,
  `category` text NOT NULL DEFAULT 'functional',
  `status` text NOT NULL DEFAULT 'pending',
  `duration` int DEFAULT 0,
  `step_results` json DEFAULT NULL,
  `final_screenshot_path` text,
  `error_message` text,
  `console_errors` json DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_execution_run_tests_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bdd_feature_files` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `test_case_id` varchar(255) DEFAULT NULL,
  `test_case_source` text DEFAULT 'functional',
  `feature_name` text NOT NULL,
  `file_name` text NOT NULL,
  `content` text NOT NULL,
  `language` text NOT NULL DEFAULT 'gherkin',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bdd_step_definitions` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `feature_file_id` varchar(255) DEFAULT NULL,
  `step_def_name` text NOT NULL,
  `file_name` text NOT NULL,
  `content` text NOT NULL,
  `language` text NOT NULL DEFAULT 'typescript',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automation_scripts` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `framework` text NOT NULL DEFAULT 'playwright',
  `language` text NOT NULL DEFAULT 'typescript',
  `content` longtext NOT NULL,
  `tags` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `api_baselines` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `base_url` text NOT NULL,
  `openapi_spec` longtext,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `api_baseline_executions` (
  `id` varchar(255) NOT NULL,
  `baseline_id` varchar(255) NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `results` json DEFAULT NULL,
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_api_baseline_exec_baseline` (`baseline_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `api_discovery_runs` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `discovered_endpoints` json DEFAULT NULL,
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `har_captures` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `session_id` varchar(255) DEFAULT NULL,
  `har_content` longtext NOT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `framework_configs` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `framework` text NOT NULL,
  `config` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `framework_functions` (
  `id` varchar(255) NOT NULL,
  `config_id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `signature` text,
  `content` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_framework_functions_config` (`config_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `framework_files` (
  `id` varchar(255) NOT NULL,
  `config_id` varchar(255) NOT NULL,
  `path` text NOT NULL,
  `content` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_framework_files_config` (`config_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `synthetic_data_jobs` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `schema_definition` json DEFAULT NULL,
  `output` json DEFAULT NULL,
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `visual_regression_baselines` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `page_url` text NOT NULL,
  `screenshot_path` text NOT NULL,
  `viewport` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `visual_regression_results` (
  `id` varchar(255) NOT NULL,
  `baseline_id` varchar(255) NOT NULL,
  `status` text NOT NULL,
  `diff_percentage` decimal(5,2) DEFAULT NULL,
  `diff_image_path` text,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vr_results_baseline` (`baseline_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `accessibility_scan_results` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `page_url` text NOT NULL,
  `status` text NOT NULL,
  `violations` json DEFAULT NULL,
  `summary` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `responsive_test_results` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `page_url` text NOT NULL,
  `viewport` json NOT NULL,
  `status` text NOT NULL,
  `issues` json DEFAULT NULL,
  `screenshot_path` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `report_validations` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `report_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `results` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `validation_results` (
  `id` varchar(255) NOT NULL,
  `validation_id` varchar(255) NOT NULL,
  `rule_name` text NOT NULL,
  `status` text NOT NULL,
  `message` text,
  `details` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_test_cases` (
  `id` varchar(255) NOT NULL,
  `project_id` varchar(255) NOT NULL,
  `jira_issue_key` text NOT NULL,
  `test_case_id` varchar(255) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

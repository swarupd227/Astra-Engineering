-- =============================================================================
-- DevX / Astra Platform — Complete Database Schema
-- MySQL 8.0+ / Aurora MySQL 3.x compatible
-- Engine: InnoDB | Charset: utf8mb4 | Collation: utf8mb4_0900_ai_ci
--
-- Generated from: shared/schema.ts + migrations/auto-generated/Provision_7_04_2026.sql
-- Run this file on a fresh (empty) database BEFORE running 02_seed.sql
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';

-- =============================================================================
-- TENANCY & LICENSING
-- =============================================================================

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `tenant_description` text,
  `vertical` varchar(100) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenants_name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `subscription_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subscription_types_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `subscription_type_id` varchar(36) NOT NULL,
  `max_users` int NOT NULL DEFAULT '50',
  `token_quota` bigint NOT NULL DEFAULT '0',
  `token_used` bigint NOT NULL DEFAULT '0',
  `start_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiry_date` timestamp NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subscriptions_tenant` (`tenant_id`),
  CONSTRAINT `fk_subscription_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
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

CREATE TABLE IF NOT EXISTS `token_usage_logs` (
  `id` varchar(36) NOT NULL,
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

-- =============================================================================
-- USERS & RBAC
-- =============================================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(36) NOT NULL,
  `azure_oid` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `provider` varchar(50) DEFAULT NULL,
  `provider_user_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `token_quota` int NOT NULL DEFAULT '0',
  `token_used` int NOT NULL DEFAULT '0',
  `mfa_secret` varchar(255) DEFAULT NULL,
  `is_mfa_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_azure_oid_unique` (`azure_oid`),
  KEY `fk_users_tenant` (`tenant_id`),
  CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `provider` varchar(50) NOT NULL,
  `role_id` int NOT NULL,
  `scope_type` enum('org','project') NOT NULL,
  `scope_id` varchar(500) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_role_scope` (`user_id`,`role_id`,`scope_type`,`scope_id`),
  KEY `fk_user_roles_role` (`role_id`),
  KEY `idx_user_roles_provider` (`provider`),
  CONSTRAINT `fk_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `role_activity_permissions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `provider` varchar(50) NOT NULL,
  `role_id` int NOT NULL,
  `activity_key` varchar(255) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_activity_permissions_tenant_provider_role_activity` (`tenant_id`,`provider`,`role_id`,`activity_key`),
  KEY `fk_role_activity_role` (`role_id`),
  CONSTRAINT `fk_role_activity_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` varchar(36) NOT NULL,
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
  KEY `idx_audit_logs_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

-- =============================================================================
-- ORGANIZATIONS & PROJECTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(100) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `projects` (
  `id` varchar(36) NOT NULL,
  `organization_id` varchar(36) DEFAULT NULL,
  `name` text NOT NULL,
  `description` text,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `type` varchar(50) NOT NULL DEFAULT 'development',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- SDLC PROJECTS & PHASES
-- =============================================================================

CREATE TABLE IF NOT EXISTS `sdlc_projects` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `organization` text,
  `repository_id` varchar(36) DEFAULT NULL,
  `repository_count` int DEFAULT '0',
  `cloud_provider` text,
  `project_id` varchar(255) DEFAULT NULL,
  `ado_project_url` text,
  `linked_golden_repo_org` text,
  `linked_golden_repo_project` text,
  `linked_golden_repo_name` text,
  `golden_repo_reference` json DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `deleted_from_ado` tinyint(1) NOT NULL DEFAULT '0',
  `enable_tdd` tinyint(1) DEFAULT '0',
  `specs_architecture_style` varchar(50) DEFAULT NULL,
  `specs_delivery_order` text,
  `integration_type` varchar(50) NOT NULL DEFAULT 'ado',
  `jira_connection_id` varchar(36) DEFAULT NULL,
  `jira_instance_url` text,
  `jira_project_key` varchar(100) DEFAULT NULL,
  `is_generating` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_phases` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `phase_name` text NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'not_started',
  `progress` int NOT NULL DEFAULT '0',
  `notes` text,
  `assigned_to` text,
  `deliverables` text,
  `start_date` timestamp NULL DEFAULT NULL,
  `end_date` timestamp NULL DEFAULT NULL,
  `completed_date` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `phase_confirmations` (
  `id` varchar(36) NOT NULL,
  `phase_id` varchar(36) NOT NULL,
  `confirmer_role` text NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `confirmer_name` text,
  `comments` text,
  `confirmed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_epics` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `acceptance_criteria` text,
  `status` varchar(50) NOT NULL DEFAULT 'planned',
  `priority` varchar(50) NOT NULL DEFAULT 'medium',
  `feature_count` int DEFAULT '0',
  `source` varchar(50) DEFAULT 'manual',
  `workflow_session_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_features` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `epic_id` varchar(36) DEFAULT NULL,
  `title` text NOT NULL,
  `description` text,
  `acceptance_criteria` text,
  `status` varchar(50) NOT NULL DEFAULT 'planned',
  `priority` varchar(50) NOT NULL DEFAULT 'medium',
  `story_count` int DEFAULT '0',
  `source` varchar(50) DEFAULT 'manual',
  `workflow_session_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_backlog_items` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `type` varchar(50) NOT NULL DEFAULT 'story',
  `story_points` int DEFAULT NULL,
  `priority` varchar(50) NOT NULL DEFAULT 'medium',
  `status` varchar(50) NOT NULL DEFAULT 'backlog',
  `assigned_to` text,
  `feature_id` varchar(36) DEFAULT NULL,
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
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_requirements` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `type` varchar(50) NOT NULL DEFAULT 'functional',
  `priority` varchar(50) NOT NULL DEFAULT 'medium',
  `status` varchar(50) NOT NULL DEFAULT 'draft',
  `brd_id` varchar(36) DEFAULT NULL,
  `requirement_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_issues` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` varchar(50) NOT NULL DEFAULT 'open',
  `priority` varchar(50) NOT NULL DEFAULT 'medium',
  `assigned_to` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_documents` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `content` longtext,
  `type` varchar(50) NOT NULL DEFAULT 'general',
  `brd_id` varchar(36) DEFAULT NULL,
  `requirement_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
  `source` varchar(50) DEFAULT 'manual',
  `source_document_id` varchar(36) DEFAULT NULL,
  `design_category` text,
  `ado_work_item_id` int DEFAULT NULL,
  `ado_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_figma_links` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `figma_url` text NOT NULL,
  `access_level` varchar(50) NOT NULL DEFAULT 'view',
  `created_by` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_design_reviews` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL,
  `design_asset_id` varchar(36) DEFAULT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `reviewed_by` text,
  `comments` text,
  `review_date` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ado_design_sync` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL DEFAULT '2',
  `last_sync_at` timestamp NULL DEFAULT NULL,
  `sync_status` varchar(100) NOT NULL DEFAULT 'pending',
  `synced_items_count` int DEFAULT '0',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_settings` (
  `id` varchar(36) NOT NULL,
  `organization_name` text,
  `project_name` text,
  `pat_token` text,
  `api_version` varchar(20) DEFAULT '7.0',
  `phase_unlock_threshold` varchar(10) DEFAULT '80',
  `enable_auto_phase_unlock` varchar(10) DEFAULT 'true',
  `require_phase_approvals` varchar(10) DEFAULT 'false',
  `default_assignee` text,
  `enable_notifications` varchar(10) DEFAULT 'true',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_specs_files` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `feature_id` int NOT NULL,
  `feature_title` text NOT NULL,
  `file_type` varchar(32) NOT NULL,
  `file_name` text NOT NULL,
  `path` text NOT NULL,
  `content` longtext NOT NULL,
  `user_stories_json` json DEFAULT NULL,
  `pushed_to_ado` tinyint(1) NOT NULL DEFAULT '0',
  `content_hash` varchar(64) DEFAULT NULL,
  `repo_commit_id` varchar(40) DEFAULT NULL,
  `input_hash` varchar(64) DEFAULT NULL,
  `spec_version` int DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sdlc_specs_files_project` (`project_id`),
  KEY `idx_sdlc_specs_files_type` (`file_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- DEVELOPMENT REPOSITORIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS `development_repositories` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `default_branch` varchar(255) DEFAULT 'main',
  `commits` int DEFAULT '0',
  `contributors` int DEFAULT '1',
  `size` varchar(50) DEFAULT '0 MB',
  `license` varchar(100) DEFAULT 'MIT',
  `last_commit_at` timestamp NULL DEFAULT NULL,
  `repository_url` text,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `development_branches` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `is_default` int NOT NULL DEFAULT '0',
  `is_protected` int NOT NULL DEFAULT '0',
  `commits` int DEFAULT '0',
  `last_commit_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_code` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `content` longtext NOT NULL,
  `language` varchar(50) NOT NULL DEFAULT 'typescript',
  `file_name` text,
  `file_path` text,
  `generated_from` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_commits` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `message` text NOT NULL,
  `commit_number` int NOT NULL DEFAULT '1',
  `author` varchar(255) NOT NULL DEFAULT 'System',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sdlc_previews` (
  `id` varchar(36) NOT NULL,
  `repository_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `preview_url` text,
  `code_status` varchar(50) NOT NULL DEFAULT 'generated',
  `commit_count` int NOT NULL DEFAULT '1',
  `last_commit_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `project_git_config` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `provider` enum('github','ado') NOT NULL DEFAULT 'ado',
  `branch` varchar(255) NOT NULL DEFAULT 'main',
  `base_path` varchar(512) DEFAULT NULL,
  `ado_repository_id` varchar(36) DEFAULT NULL,
  `ado_repository_name` varchar(255) DEFAULT NULL,
  `token` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_git_config_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- WORKFLOW ARTIFACTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS `workflow_artifacts` (
  `id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `project_id` varchar(255) DEFAULT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `requirement_ids` json DEFAULT NULL,
  `requirement` longtext NOT NULL,
  `guidelines` longtext,
  `epics` json NOT NULL DEFAULT ('[]'),
  `features` json NOT NULL DEFAULT ('[]'),
  `user_stories` json NOT NULL DEFAULT ('[]'),
  `personas` json NOT NULL DEFAULT ('[]'),
  `wiki_pages` json NOT NULL DEFAULT ('[]'),
  `figma_guidelines` longtext,
  `status` varchar(50) NOT NULL DEFAULT 'draft',
  `modified` tinyint(1) DEFAULT '0',
  `approval_status` varchar(20) DEFAULT NULL,
  `modified_count` int DEFAULT '0',
  `total_count` int DEFAULT '0',
  `modified_items` json NOT NULL DEFAULT ('{"epics":[],"features":[],"userStories":[]}'),
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_workflow_artifacts_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_subtasks` (
  `id` varchar(36) NOT NULL,
  `artifact_id` varchar(36) NOT NULL,
  `user_story_id` varchar(36) NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `estimated_hours` int DEFAULT '0',
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `assigned_to` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_test_cases` (
  `id` varchar(36) NOT NULL,
  `artifact_id` varchar(36) NOT NULL,
  `user_story_id` varchar(36) NOT NULL,
  `title` text NOT NULL,
  `scenario` text,
  `steps` json NOT NULL DEFAULT ('[]'),
  `preconditions` text,
  `postconditions` text,
  `priority` varchar(20) DEFAULT 'Medium',
  `automation_status` varchar(50) DEFAULT 'Not Automated',
  `ado_test_case_id` varchar(100) DEFAULT NULL,
  `ado_test_plan_id` varchar(100) DEFAULT NULL,
  `ado_test_suite_id` varchar(100) DEFAULT NULL,
  `is_pushed_to_ado` tinyint(1) DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_generation_jobs` (
  `job_id` varchar(36) NOT NULL,
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

CREATE TABLE IF NOT EXISTS `artifact_events` (
  `id` varchar(36) NOT NULL,
  `artifact_id` varchar(100) NOT NULL,
  `use_case` varchar(50) NOT NULL,
  `user_id` varchar(100) NOT NULL,
  `project_id` varchar(100) NOT NULL,
  `status` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tokens_used` int NOT NULL,
  `processing_time_ms` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_artifact_events_project_id` (`project_id`),
  KEY `idx_artifact_events_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- BRD (BUSINESS REQUIREMENTS DOCUMENT)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `brd_documents` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_by` varchar(36) NOT NULL,
  `project_description` longtext,
  `business_objectives` longtext,
  `acceptance_criteria` longtext,
  `target_audience` longtext,
  `key_features` longtext,
  `constraints` longtext,
  `success_criteria` longtext,
  `timeline` longtext,
  `budget` longtext,
  `stakeholders` longtext,
  `existing_requirements` longtext,
  `project_details` longtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_documents` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_by` varchar(36) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'draft',
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
  `brd_file` longblob,
  `brd_file_name` varchar(255) DEFAULT NULL,
  `brd_file_type` varchar(100) DEFAULT NULL,
  `brd_file_size` bigint DEFAULT NULL,
  `generated_markdown` longtext,
  `generated_brd_json` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_brd_project` (`project_id`),
  KEY `idx_dev_brd_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `dev_brd_requirements` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `brd_id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) DEFAULT NULL,
  `requirement_name` text NOT NULL,
  `description` text,
  `priority` varchar(50) DEFAULT 'medium',
  `acceptance_criteria` text,
  `status` varchar(50) NOT NULL DEFAULT 'new',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_brd_req_project` (`project_id`),
  KEY `idx_dev_brd_req_brd` (`brd_id`),
  CONSTRAINT `fk_dev_brd_requirements_brd` FOREIGN KEY (`brd_id`) REFERENCES `dev_brd_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_file_versions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `brd_id` varchar(36) NOT NULL,
  `version` int NOT NULL,
  `file_blob` longblob NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(100) NOT NULL,
  `file_size` bigint DEFAULT NULL,
  `uploaded_by` varchar(36) NOT NULL,
  `uploaded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_brd_version` (`brd_id`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_brd_attachments` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `brd_version_id` bigint NOT NULL,
  `attached_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `attached_by` varchar(36) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brd_generation_metrics` (
  `id` varchar(36) NOT NULL,
  `job_id` varchar(36) NOT NULL,
  `brd_id` varchar(36) DEFAULT NULL,
  `project_id` varchar(36) NOT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `duration_ms` bigint DEFAULT NULL,
  `brd_template_id` varchar(50) DEFAULT 'gold_1_0',
  `brd_generation_mode` varchar(50) DEFAULT NULL,
  `llm_provider` varchar(50) DEFAULT 'openai_integrations',
  `brd_chat_model` varchar(120) DEFAULT NULL,
  `brd_repair_chat_model` varchar(120) DEFAULT NULL,
  `brd_extraction_chat_model` varchar(120) DEFAULT NULL,
  `llm_models_json` json DEFAULT NULL,
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
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brd_gen_metrics_job_idx` (`job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- WIKI / DOCUMENTATION
-- =============================================================================

CREATE TABLE IF NOT EXISTS `wiki_pages` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `session_id` varchar(36) DEFAULT NULL,
  `page_type` text NOT NULL,
  `phase` varchar(50) NOT NULL DEFAULT 'reference',
  `title` text NOT NULL,
  `content` longtext NOT NULL,
  `order` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wiki_pages_project` (`project_id`),
  KEY `idx_wiki_pages_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `test_plan_documents` (
  `id` varchar(36) NOT NULL,
  `test_plan_name` varchar(255) NOT NULL,
  `brd_id` varchar(36) NOT NULL,
  `brd_title` varchar(255) DEFAULT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `organization_id` varchar(36) DEFAULT NULL,
  `content` longtext NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `ado_id` varchar(50) DEFAULT NULL,
  `ado_org` varchar(255) DEFAULT NULL,
  `ado_project` varchar(255) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_test_plan_brd_id` (`brd_id`),
  KEY `idx_test_plan_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- DESIGN & PERSONAS
-- =============================================================================

CREATE TABLE IF NOT EXISTS `personas` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `color` text NOT NULL,
  `focus` text NOT NULL,
  `pain_points` json NOT NULL,
  `goals` json NOT NULL,
  `is_default` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
  `brd_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_design_mappings_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `design_guidelines` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL DEFAULT 'Generated Design Guidelines',
  `type` varchar(100) NOT NULL DEFAULT 'Design Guidelines',
  `content` longtext NOT NULL,
  `figma_link` text,
  `user_prompt` text,
  `generated_prompt` longtext NOT NULL,
  `guidelines_content` longtext,
  `ado_work_item_id` int DEFAULT NULL,
  `ado_pushed_at` timestamp NULL DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- INTEGRATIONS (ADO / JIRA)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ado_settings` (
  `id` varchar(36) NOT NULL,
  `organization_url` text NOT NULL,
  `project_name` text NOT NULL,
  `repository` text,
  `branch` text,
  `pat_token` text,
  `api_version` varchar(20) NOT NULL DEFAULT '7.0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_connections` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `instance_url` varchar(500) NOT NULL,
  `email` varchar(255) NOT NULL,
  `api_token_encrypted` text NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_settings` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `connection_id` varchar(36) DEFAULT NULL,
  `instance_url` varchar(500) NOT NULL,
  `project_key` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `api_token` text,
  `api_token_encrypted` text NOT NULL,
  `story_points_field_id` varchar(100) DEFAULT NULL,
  `epic_link_field_id` varchar(100) DEFAULT NULL,
  `sprint_field_id` varchar(100) DEFAULT NULL,
  `acceptance_criteria_field_id` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_tested_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `jira_settings_project_unique` (`project_id`),
  KEY `idx_jira_settings_connection_id` (`connection_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `jira_design_sync` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `phase_number` int NOT NULL DEFAULT '2',
  `last_sync_at` timestamp NULL DEFAULT NULL,
  `sync_status` text NOT NULL,
  `synced_items_count` int DEFAULT '0',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_jira_design_sync_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `integration_settings` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `integration_type` varchar(50) NOT NULL DEFAULT 'ado',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `integration_settings_project_unique` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `workflow_settings` (
  `id` varchar(36) NOT NULL,
  `repository_name` text,
  `project_name` text,
  `organization_url` text,
  `pat_token` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `conversational_ui_settings` (
  `id` varchar(36) NOT NULL,
  `organization_name` text NOT NULL,
  `project_name` text NOT NULL,
  `pat_token` text,
  `api_version` varchar(20) NOT NULL DEFAULT '7.0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- GOLDEN REPOSITORIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS `golden_repositories` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `technologies` json NOT NULL,
  `stars` int NOT NULL DEFAULT '0',
  `cloud_provider` text,
  `repository_url` text,
  `category` text,
  `domain` varchar(100) NOT NULL DEFAULT 'insurance',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `golden_repo_organizations` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `organization_url` text NOT NULL,
  `project_name` text NOT NULL,
  `repository_name` text,
  `api_version` varchar(20) NOT NULL DEFAULT '7.0',
  `pat_token` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_organizations` (
  `id` varchar(36) NOT NULL,
  `project_name` text NOT NULL,
  `organization_url` text NOT NULL,
  `pat_token` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- RAG / VECTOR CACHE
-- =============================================================================

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
  UNIQUE KEY `vectorized_guidelines_content_hash_unique` (`content_hash`)
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
  CONSTRAINT `guideline_chunks_ibfk_1` FOREIGN KEY (`guideline_id`) REFERENCES `vectorized_guidelines` (`id`) ON DELETE CASCADE
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
  UNIQUE KEY `uk_devx_vectorized_guidelines_content_hash` (`content_hash`)
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
  CONSTRAINT `fk_devx_guideline_chunks_guideline` FOREIGN KEY (`guideline_id`) REFERENCES `devx_vectorized_guidelines` (`id`) ON DELETE CASCADE
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
  KEY `idx_devx_rag_sessions_project_id` (`project_id`)
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
  KEY `idx_rag_sessions_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ai_enhance_mappings` (
  `id` varchar(36) NOT NULL,
  `location_key` varchar(255) NOT NULL,
  `repository_id` varchar(64) NOT NULL,
  `folder_path` text NOT NULL,
  `file_path` text NOT NULL,
  `file_name` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- CONVERSATION / CHAT UI
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ConversationTitles` (
  `conversation_id` varchar(36) NOT NULL,
  `user_id` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ConversationSummary` (
  `conversation_id` varchar(36) NOT NULL,
  `summary` text,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`conversation_id`),
  CONSTRAINT `fk_summary_titles` FOREIGN KEY (`conversation_id`) REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
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

-- =============================================================================
-- AI SESSIONS (Contextual Chat / AI Cost Tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `msal_users` (
  `id` varchar(36) NOT NULL,
  `aad_object_id` varchar(255) NOT NULL,
  `user_name` varchar(255) NOT NULL,
  `user_email` varchar(255) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `home_account_id` varchar(255) DEFAULT NULL,
  `tenant_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `msal_users_aad_unique` (`aad_object_id`),
  KEY `idx_msal_user_email` (`user_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_sessions` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `title` varchar(500) NOT NULL,
  `status` enum('IN_PROGRESS','PAUSED','COMPLETED','INACTIVE') NOT NULL DEFAULT 'IN_PROGRESS',
  `current_screen` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_accessed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_sessions_project_user` (`project_id`,`user_id`,`id`),
  KEY `idx_ai_sessions_user_id` (`user_id`),
  CONSTRAINT `fk_ai_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `msal_users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_usage_logs` (
  `id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `call_id` varchar(100) DEFAULT NULL,
  `model` varchar(100) NOT NULL,
  `provider` varchar(50) NOT NULL DEFAULT 'azure',
  `input_tokens` int NOT NULL DEFAULT '0',
  `output_tokens` int NOT NULL DEFAULT '0',
  `total_tokens` int NOT NULL DEFAULT '0',
  `input_price_per_1k` decimal(10,6) NOT NULL DEFAULT '0.000000',
  `output_price_per_1k` decimal(10,6) NOT NULL DEFAULT '0.000000',
  `cost` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `request_metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_usage_session` (`session_id`),
  CONSTRAINT `fk_ai_usage_logs_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_cost_summaries` (
  `id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `total_cost` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `total_input_tokens` bigint NOT NULL DEFAULT '0',
  `total_output_tokens` bigint NOT NULL DEFAULT '0',
  `total_calls` int NOT NULL DEFAULT '0',
  `last_calculated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_cost_summaries_session_unique` (`session_id`),
  CONSTRAINT `fk_session_cost_summaries_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_states` (
  `id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `state_snapshot` longtext NOT NULL,
  `cursor_state` json DEFAULT NULL,
  `inputs` json DEFAULT NULL,
  `outputs` json DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_states_session_unique` (`session_id`),
  CONSTRAINT `fk_session_states_session` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- QA / AUTOMATED TESTING
-- =============================================================================

CREATE TABLE IF NOT EXISTS `crawl_runs` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `base_url` text NOT NULL,
  `environment` varchar(50) NOT NULL,
  `user_role` varchar(50) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL DEFAULT NULL,
  `pages_discovered` int NOT NULL DEFAULT '0',
  `dom_versions_created` int NOT NULL DEFAULT '0',
  `status` varchar(50) NOT NULL DEFAULT 'running',
  `error_message` text,
  `config` json DEFAULT NULL,
  `project_id` varchar(36) DEFAULT NULL,
  `organization_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_crawl_runs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `automated_test_pages` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `crawl_run_id` varchar(36) NOT NULL DEFAULT '',
  `page_type` varchar(255) NOT NULL,
  `route_pattern` varchar(500) NOT NULL,
  `sample_url` text NOT NULL,
  `user_role` varchar(50) NOT NULL,
  `title` varchar(512) DEFAULT NULL,
  `depth` int NOT NULL DEFAULT '0',
  `parent_page_id` varchar(36) DEFAULT NULL,
  `link_count` int NOT NULL DEFAULT '0',
  `form_count` int NOT NULL DEFAULT '0',
  `element_count` int NOT NULL DEFAULT '0',
  `page_signature_hash` varchar(64) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `automated_test_pages_run_route_role` (`crawl_run_id`,`route_pattern`,`user_role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `page_dom_versions` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `page_id` varchar(36) NOT NULL,
  `version_number` int NOT NULL,
  `dom_hash` varchar(64) DEFAULT NULL,
  `dom_contract` json NOT NULL,
  `extracted_by` varchar(100) DEFAULT NULL,
  `extracted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_page_version` (`page_id`,`version_number`),
  CONSTRAINT `page_dom_versions_ibfk_1` FOREIGN KEY (`page_id`) REFERENCES `automated_test_pages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dom_actions` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `dom_version_id` varchar(36) NOT NULL,
  `action_name` varchar(255) NOT NULL,
  `action_type` varchar(50) NOT NULL,
  `selector` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dom_action_version` (`dom_version_id`),
  CONSTRAINT `dom_actions_ibfk_1` FOREIGN KEY (`dom_version_id`) REFERENCES `page_dom_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dom_forms` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `dom_version_id` varchar(36) NOT NULL,
  `form_name` varchar(255) DEFAULT NULL,
  `submit_action` varchar(255) DEFAULT NULL,
  `fields` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dom_form_version` (`dom_version_id`),
  CONSTRAINT `dom_forms_ibfk_1` FOREIGN KEY (`dom_version_id`) REFERENCES `page_dom_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `navigation_edges` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `from_page_id` varchar(36) NOT NULL,
  `to_page_id` varchar(36) NOT NULL,
  `via_action` varchar(255) DEFAULT NULL,
  `user_role` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_navigation_edge` (`from_page_id`,`to_page_id`,`via_action`,`user_role`),
  CONSTRAINT `navigation_edges_ibfk_1` FOREIGN KEY (`from_page_id`) REFERENCES `automated_test_pages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `navigation_edges_ibfk_2` FOREIGN KEY (`to_page_id`) REFERENCES `automated_test_pages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `automated_test_cases` (
  `id` varchar(36) NOT NULL,
  `crawl_run_id` varchar(36) NOT NULL,
  `page_id` varchar(36) DEFAULT NULL,
  `case_code` varchar(64) NOT NULL,
  `title` varchar(512) NOT NULL,
  `test_type` varchar(64) NOT NULL DEFAULT 'ui',
  `steps` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_cases_crawl_run_id` (`crawl_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_scripts` (
  `id` varchar(36) NOT NULL,
  `crawl_run_id` varchar(36) NOT NULL,
  `file_name` varchar(255) NOT NULL DEFAULT 'autonomous.spec.ts',
  `script_content` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_scripts_crawl_run_id` (`crawl_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_runs` (
  `id` varchar(36) NOT NULL,
  `crawl_run_id` varchar(36) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'pending',
  `total_tests` int NOT NULL DEFAULT '0',
  `passed_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL DEFAULT NULL,
  `error_message` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `automated_test_results` (
  `id` varchar(36) NOT NULL,
  `test_run_id` varchar(36) NOT NULL,
  `test_case_id` varchar(36) NOT NULL,
  `case_code` varchar(64) DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `severity` varchar(20) DEFAULT NULL,
  `error_message` text,
  `duration_ms` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_automated_test_results_test_run_id` (`test_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `page_dom_elements` (
  `id` varchar(36) NOT NULL,
  `page_id` varchar(36) NOT NULL,
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

CREATE TABLE IF NOT EXISTS `page_forms` (
  `id` varchar(36) NOT NULL,
  `page_id` varchar(36) NOT NULL,
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

-- =============================================================================
-- STACK MODERNIZATION
-- =============================================================================

CREATE TABLE IF NOT EXISTS `modernization_analyses` (
  `id` varchar(36) NOT NULL,
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
  KEY `idx_mod_analyses_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `modernization_phase_outputs` (
  `id` varchar(36) NOT NULL,
  `analysis_id` varchar(36) NOT NULL,
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
  `id` varchar(36) NOT NULL,
  `analysis_id` varchar(36) NOT NULL,
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
  KEY `idx_token_analysis` (`analysis_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `modernization_version_changes` (
  `id` varchar(36) NOT NULL,
  `analysis_id` varchar(36) NOT NULL,
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

-- =============================================================================
-- PROVISIONING
-- =============================================================================

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
  KEY `idx_provisioning_instances_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- SPRINTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS `sprints` (
  `id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `goal` text,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `status` enum('upcoming','active','completed') DEFAULT 'upcoming',
  `type` enum('general','design') DEFAULT 'general',
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sprints_project_id` (`project_id`),
  KEY `idx_sprints_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- INTERNAL MIGRATION TRACKING
-- =============================================================================

CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `hash` text NOT NULL,
  `created_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `migration_name` varchar(255) NOT NULL,
  `description` text,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_time_ms` int DEFAULT NULL,
  `status` enum('success','failed','rolled_back') DEFAULT 'success',
  `error_message` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `migration_name` (`migration_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- End of baseline schema (phase 1 of migration-order.json)
-- Run full migration via: npm run migrate:dev  (or RUN_DB_SEED=true for seeds)
-- See: migrations/CLIENT_DATABASE_SETUP.md
-- =============================================================================

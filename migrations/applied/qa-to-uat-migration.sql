-- ============================================
-- Schema Migration: QA to UAT
-- Generated: 2025-11-24T05:43:30.878Z
-- ============================================

SET FOREIGN_KEY_CHECKS=0;

-- ============================================
-- Create Missing Tables
-- ============================================

-- Create table: workflow_artifacts
CREATE TABLE `workflow_artifacts` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `project_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requirement` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `guidelines` longtext COLLATE utf8mb4_unicode_ci,
  `epics` json NOT NULL,
  `features` json NOT NULL,
  `user_stories` json NOT NULL,
  `personas` json NOT NULL,
  `wiki_pages` json NOT NULL,
  `figma_guidelines` longtext COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `modified` tinyint(1) DEFAULT '0',
  `approval_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create table: workflow_subtasks
CREATE TABLE `workflow_subtasks` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `artifact_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_story_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `estimated_hours` int DEFAULT '0',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `assigned_to` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_artifact_id` (`artifact_id`),
  KEY `idx_user_story_id` (`user_story_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `workflow_subtasks_ibfk_1` FOREIGN KEY (`artifact_id`) REFERENCES `workflow_artifacts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Modify Existing Tables
-- ============================================

-- Table: sdlc_projects
ALTER TABLE `sdlc_projects` ADD COLUMN `project_id` varchar(255) AFTER `updated_at`;
ALTER TABLE `sdlc_projects` ADD COLUMN `ado_project_url` text AFTER `project_id`;
ALTER TABLE `sdlc_projects` ADD COLUMN `linked_golden_repo_org` text AFTER `ado_project_url`;
ALTER TABLE `sdlc_projects` ADD COLUMN `linked_golden_repo_project` text AFTER `linked_golden_repo_org`;

-- Table: wiki_pages
ALTER TABLE `wiki_pages` ADD COLUMN `phase` varchar(50) NOT NULL DEFAULT 'reference' AFTER `page_type`;


SET FOREIGN_KEY_CHECKS=1;

-- ============================================
-- Migration Complete
-- ============================================
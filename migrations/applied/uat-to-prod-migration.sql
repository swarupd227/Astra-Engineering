-- ============================================
-- Schema Migration: UAT to PROD
-- Generated: 2025-11-24T06:28:57.845Z
-- ============================================

SET FOREIGN_KEY_CHECKS=0;

-- ============================================
-- WARNING: Tables in PROD but not in UAT (not modified)
-- ============================================
-- Table: sdlc_features (exists in PROD but not in UAT)

-- ============================================
-- Modify Existing Tables
-- ============================================

-- Table: sdlc_backlog_items
-- WARNING: Columns in PROD but not in UAT (not modified):
--   - feature_id
--   - epic_id
--   - persona
--   - persona_id
--   - acceptance_criteria
--   - subtasks
--   - source
--   - workflow_session_id

-- Table: sdlc_epics
-- WARNING: Columns in PROD but not in UAT (not modified):
--   - acceptance_criteria
--   - source
--   - workflow_session_id

-- Table: sdlc_projects
ALTER TABLE `sdlc_projects` ADD COLUMN `project_id` varchar(255) AFTER `updated_at`;
ALTER TABLE `sdlc_projects` ADD COLUMN `ado_project_url` text AFTER `project_id`;
ALTER TABLE `sdlc_projects` ADD COLUMN `linked_golden_repo_org` text AFTER `ado_project_url`;
ALTER TABLE `sdlc_projects` ADD COLUMN `linked_golden_repo_project` text AFTER `linked_golden_repo_org`;

-- Table: workflow_artifacts
ALTER TABLE `workflow_artifacts` ADD COLUMN `modified` tinyint(1) DEFAULT '0' AFTER `updated_at`;
ALTER TABLE `workflow_artifacts` ADD COLUMN `approval_status` varchar(20) AFTER `modified`;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `project_id` varchar(255);
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `epics` json NOT NULL;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `features` json NOT NULL;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `user_stories` json NOT NULL;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `personas` json NOT NULL;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `wiki_pages` json NOT NULL;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP DEFAULT_GENERATED;
ALTER TABLE `workflow_artifacts` MODIFY COLUMN `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP DEFAULT_GENERATED on update CURRENT_TIMESTAMP;

CREATE INDEX `idx_created_at` ON `workflow_artifacts` (`created_at`);
CREATE INDEX `idx_project_id` ON `workflow_artifacts` (`project_id`);
CREATE INDEX `idx_session_id` ON `workflow_artifacts` (`session_id`);
CREATE INDEX `idx_status` ON `workflow_artifacts` (`status`);
-- Table: workflow_subtasks
ALTER TABLE `workflow_subtasks` MODIFY COLUMN `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP DEFAULT_GENERATED;
ALTER TABLE `workflow_subtasks` MODIFY COLUMN `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP DEFAULT_GENERATED on update CURRENT_TIMESTAMP;

CREATE INDEX `idx_artifact_id` ON `workflow_subtasks` (`artifact_id`);
CREATE INDEX `idx_status` ON `workflow_subtasks` (`status`);
CREATE INDEX `idx_user_story_id` ON `workflow_subtasks` (`user_story_id`);
ALTER TABLE `workflow_subtasks` ADD CONSTRAINT `workflow_subtasks_ibfk_1` FOREIGN KEY (`artifact_id`) REFERENCES `workflow_artifacts` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;

SET FOREIGN_KEY_CHECKS=1;

-- ============================================
-- Migration Complete
-- ============================================
-- ============================================
-- Complete Schema Migration Script: QA to UAT
-- ============================================
-- Description: This script migrates COMPLETE database schema from QA to UAT environment
--              Schema only - NO DATA migration
-- 
-- This script creates all tables and adds missing columns based on the complete schema definition.
-- It uses CREATE TABLE IF NOT EXISTS and ALTER TABLE to ensure all tables and columns exist.
-- 
-- USAGE OPTIONS:
-- 
-- Option 1: Use this script directly (recommended)
--   This script includes all table definitions and will create missing tables/columns:
--   mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/qa-to-uat-schema-migration.sql
--
-- Option 2: Extract schema from QA first, then apply
--   1. Extract schema from QA:
--      On Linux/Mac: ./migrations/extract-qa-schema.sh
--      On Windows:   .\migrations\extract-qa-schema.ps1
--      Or manually:
--      mysqldump -h qadevxmysqlserver.mysql.database.azure.com -u devxadmin -p \
--        --no-data --routines --triggers --single-transaction \
--        qadevxdb > qa-schema-extract.sql
--
--   2. Review the extracted schema file
--
--   3. Apply extracted schema to UAT:
--      mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < qa-schema-extract.sql
-- 
-- IMPORTANT: 
--   1. Review this script before executing
--   2. Backup UAT database before running:
--      mysqldump -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb > uat-backup-$(date +%Y%m%d_%H%M%S).sql
--   3. Test in a non-production environment first
--   4. This script is idempotent - safe to run multiple times
-- ============================================

SET @source_db = 'qadevxdb';
SET @target_db = 'uatdevxdb';
SET @source_host = 'qadevxmysqlserver.mysql.database.azure.com';
SET @target_host = 'uatdevxmysqlserver.mysql.database.azure.com';

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================
-- Helper Procedures
-- ============================================
DELIMITER $$

DROP PROCEDURE IF EXISTS AddColumnIfNotExists$$
CREATE PROCEDURE AddColumnIfNotExists(
    IN table_name VARCHAR(255),
    IN column_name VARCHAR(255),
    IN column_definition TEXT
)
BEGIN
    DECLARE column_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO column_count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name
      AND COLUMN_NAME = column_name;
    
    IF column_count = 0 THEN
        SET @sql = CONCAT('ALTER TABLE `', table_name, '` ADD COLUMN `', column_name, '` ', column_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column: ', table_name, '.', column_name) AS result;
    ELSE
        SELECT CONCAT('Column already exists: ', table_name, '.', column_name) AS result;
    END IF;
END$$

DROP PROCEDURE IF EXISTS CreateTableIfNotExists$$
CREATE PROCEDURE CreateTableIfNotExists(
    IN table_name VARCHAR(255),
    IN create_statement TEXT
)
BEGIN
    DECLARE table_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO table_count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name;
    
    IF table_count = 0 THEN
        SET @sql = create_statement;
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Created table: ', table_name) AS result;
    ELSE
        SELECT CONCAT('Table already exists: ', table_name) AS result;
    END IF;
END$$

DELIMITER ;

-- ============================================
-- Core Tables (Order matters for foreign keys)
-- ============================================

-- Users table
CALL CreateTableIfNotExists('users',
    'CREATE TABLE users (
      id VARCHAR(36) PRIMARY KEY,
      username TEXT NOT NULL,
      password TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Organizations table
CALL CreateTableIfNotExists('organizations',
    'CREATE TABLE organizations (
      id VARCHAR(36) PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      industry TEXT,
      status VARCHAR(50) NOT NULL DEFAULT ''active'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Projects table
CALL CreateTableIfNotExists('projects',
    'CREATE TABLE projects (
      id VARCHAR(36) PRIMARY KEY,
      organization_id VARCHAR(36),
      name TEXT NOT NULL,
      description TEXT,
      status VARCHAR(50) NOT NULL DEFAULT ''active'',
      type VARCHAR(50) NOT NULL DEFAULT ''development'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Golden Repositories table
CALL CreateTableIfNotExists('golden_repositories',
    'CREATE TABLE golden_repositories (
      id VARCHAR(36) PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      technologies JSON NOT NULL,
      stars INT NOT NULL DEFAULT 0,
      cloud_provider TEXT,
      repository_url TEXT,
      category TEXT,
      domain TEXT NOT NULL DEFAULT ''insurance'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Azure DevOps Settings table
CALL CreateTableIfNotExists('ado_settings',
    'CREATE TABLE ado_settings (
      id VARCHAR(36) PRIMARY KEY,
      organization_url TEXT NOT NULL,
      project_name TEXT NOT NULL,
      repository TEXT,
      branch TEXT,
      pat_token TEXT,
      api_version TEXT NOT NULL DEFAULT ''7.0'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Artifact Organizations table
CALL CreateTableIfNotExists('artifact_organizations',
    'CREATE TABLE artifact_organizations (
      id VARCHAR(36) PRIMARY KEY,
      project_name TEXT NOT NULL,
      organization_url TEXT NOT NULL,
      pat_token TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Golden Repository Organizations table
CALL CreateTableIfNotExists('golden_repo_organizations',
    'CREATE TABLE golden_repo_organizations (
      id VARCHAR(36) PRIMARY KEY,
      name TEXT NOT NULL,
      organization_url TEXT NOT NULL,
      project_name TEXT NOT NULL,
      repository_name TEXT,
      api_version TEXT NOT NULL DEFAULT ''7.0'',
      pat_token TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Conversational UI Settings table
CALL CreateTableIfNotExists('conversational_ui_settings',
    'CREATE TABLE conversational_ui_settings (
      id VARCHAR(36) PRIMARY KEY,
      organization_name TEXT NOT NULL,
      project_name TEXT NOT NULL,
      pat_token TEXT,
      api_version VARCHAR(20) NOT NULL DEFAULT ''7.0'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Workflow Settings table
CALL CreateTableIfNotExists('workflow_settings',
    'CREATE TABLE workflow_settings (
      id VARCHAR(36) PRIMARY KEY,
      repository_name TEXT,
      project_name TEXT,
      organization_url TEXT,
      pat_token TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Settings table
CALL CreateTableIfNotExists('sdlc_settings',
    'CREATE TABLE sdlc_settings (
      id VARCHAR(36) PRIMARY KEY,
      organization_name TEXT,
      project_name TEXT,
      pat_token TEXT,
      api_version VARCHAR(20) DEFAULT ''7.0'',
      phase_unlock_threshold TEXT DEFAULT ''80'',
      enable_auto_phase_unlock TEXT DEFAULT ''true'',
      require_phase_approvals TEXT DEFAULT ''false'',
      default_assignee TEXT,
      enable_notifications TEXT DEFAULT ''true'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Personas table
CALL CreateTableIfNotExists('personas',
    'CREATE TABLE personas (
      id VARCHAR(36) PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      color TEXT NOT NULL,
      focus TEXT NOT NULL,
      pain_points JSON NOT NULL,
      goals JSON NOT NULL,
      is_default INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Wiki Pages table
CALL CreateTableIfNotExists('wiki_pages',
    'CREATE TABLE wiki_pages (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36),
      session_id VARCHAR(36),
      page_type TEXT NOT NULL,
      phase VARCHAR(50) NOT NULL DEFAULT ''reference'',
      title TEXT NOT NULL,
      content LONGTEXT NOT NULL,
      `order` INT DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      INDEX idx_session_id (session_id),
      INDEX idx_phase (phase)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Add phase column if it doesn't exist (for existing tables)
CALL AddColumnIfNotExists('wiki_pages', 'phase', "VARCHAR(50) NOT NULL DEFAULT 'reference' COMMENT 'SDLC phase: planning, requirements, design, implementation, testing, deployment, reference'");

-- Update existing records if phase column was just added
UPDATE wiki_pages 
SET phase = 'planning' 
WHERE phase = 'reference' 
  AND page_type IN ('overview', 'feasibility-study', 'risk-assessment');

UPDATE wiki_pages 
SET phase = 'requirements' 
WHERE phase = 'reference' 
  AND page_type IN ('business-requirements', 'srs', 'use-cases', 'rtm', 'use-case-diagram', 'dfd');

UPDATE wiki_pages 
SET phase = 'design' 
WHERE phase = 'reference' 
  AND page_type IN ('technical-architecture', 'system-design', 'ui-ux-design', 'database-design', 'class-diagram', 'sequence-diagram', 'component-diagram', 'data-models');

UPDATE wiki_pages 
SET phase = 'implementation' 
WHERE phase = 'reference' 
  AND page_type IN ('features', 'api', 'coding-standards', 'version-control', 'infrastructure-diagram');

UPDATE wiki_pages 
SET phase = 'testing' 
WHERE phase = 'reference' 
  AND page_type IN ('testing', 'test-plan', 'test-cases', 'test-coverage-matrix');

UPDATE wiki_pages 
SET phase = 'deployment' 
WHERE phase = 'reference' 
  AND page_type IN ('deployment', 'release-notes', 'user-manual', 'maintenance-plan');

-- SDLC Projects table
CALL CreateTableIfNotExists('sdlc_projects',
    'CREATE TABLE sdlc_projects (
      id VARCHAR(36) PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      organization TEXT,
      repository_id VARCHAR(36),
      repository_count INT DEFAULT 0,
      cloud_provider TEXT,
      project_id VARCHAR(255),
      ado_project_url TEXT,
      linked_golden_repo_org TEXT,
      linked_golden_repo_project TEXT,
      status TEXT NOT NULL DEFAULT ''active'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Phases table
CALL CreateTableIfNotExists('sdlc_phases',
    'CREATE TABLE sdlc_phases (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      phase_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT ''not_started'',
      progress INT NOT NULL DEFAULT 0,
      notes TEXT,
      assigned_to TEXT,
      deliverables TEXT,
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      completed_date TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      INDEX idx_phase_number (phase_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Phase Confirmations table
CALL CreateTableIfNotExists('phase_confirmations',
    'CREATE TABLE phase_confirmations (
      id VARCHAR(36) PRIMARY KEY,
      phase_id VARCHAR(36) NOT NULL,
      confirmer_role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT ''pending'',
      confirmer_name TEXT,
      comments TEXT,
      confirmed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_phase_id (phase_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Development Repositories table
CALL CreateTableIfNotExists('development_repositories',
    'CREATE TABLE development_repositories (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_branch TEXT DEFAULT ''main'',
      commits INT DEFAULT 0,
      contributors INT DEFAULT 1,
      size TEXT DEFAULT ''0 MB'',
      license TEXT DEFAULT ''MIT'',
      last_commit_at TIMESTAMP,
      repository_url TEXT,
      status TEXT NOT NULL DEFAULT ''active'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Development Branches table
CALL CreateTableIfNotExists('development_branches',
    'CREATE TABLE development_branches (
      id VARCHAR(36) PRIMARY KEY,
      repository_id VARCHAR(36) NOT NULL,
      name TEXT NOT NULL,
      is_default INT NOT NULL DEFAULT 0,
      is_protected INT NOT NULL DEFAULT 0,
      commits INT DEFAULT 0,
      last_commit_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_repository_id (repository_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Issues table
CALL CreateTableIfNotExists('sdlc_issues',
    'CREATE TABLE sdlc_issues (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT ''open'',
      priority TEXT NOT NULL DEFAULT ''medium'',
      assigned_to TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Epics table
CALL CreateTableIfNotExists('sdlc_epics',
    'CREATE TABLE sdlc_epics (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria TEXT,
      status TEXT NOT NULL DEFAULT ''planned'',
      priority TEXT NOT NULL DEFAULT ''medium'',
      feature_count INT DEFAULT 0,
      source VARCHAR(50) DEFAULT ''manual'',
      workflow_session_id VARCHAR(36),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number),
      INDEX idx_workflow_session (workflow_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Add missing columns to sdlc_epics if table exists
CALL AddColumnIfNotExists('sdlc_epics', 'source', "VARCHAR(50) DEFAULT 'manual'");
CALL AddColumnIfNotExists('sdlc_epics', 'workflow_session_id', "VARCHAR(36)");

-- SDLC Features table
CALL CreateTableIfNotExists('sdlc_features',
    'CREATE TABLE sdlc_features (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      epic_id VARCHAR(36),
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria TEXT,
      status VARCHAR(50) NOT NULL DEFAULT ''planned'',
      priority VARCHAR(50) NOT NULL DEFAULT ''medium'',
      story_count INT DEFAULT 0,
      source VARCHAR(50) DEFAULT ''manual'',
      workflow_session_id VARCHAR(36),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number),
      INDEX idx_epic (epic_id),
      INDEX idx_workflow_session (workflow_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Add missing columns to sdlc_features if table exists
CALL AddColumnIfNotExists('sdlc_features', 'source', "VARCHAR(50) DEFAULT 'manual'");
CALL AddColumnIfNotExists('sdlc_features', 'workflow_session_id', "VARCHAR(36)");

-- SDLC Requirements table
CALL CreateTableIfNotExists('sdlc_requirements',
    'CREATE TABLE sdlc_requirements (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT ''functional'',
      priority TEXT NOT NULL DEFAULT ''medium'',
      status TEXT NOT NULL DEFAULT ''draft'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Backlog Items table
CALL CreateTableIfNotExists('sdlc_backlog_items',
    'CREATE TABLE sdlc_backlog_items (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT ''story'',
      story_points INT,
      priority TEXT NOT NULL DEFAULT ''medium'',
      status TEXT NOT NULL DEFAULT ''backlog'',
      assigned_to TEXT,
      feature_id VARCHAR(36),
      epic_id VARCHAR(36),
      figma_link TEXT,
      persona TEXT,
      persona_id VARCHAR(36),
      acceptance_criteria JSON,
      subtasks JSON,
      source VARCHAR(50) DEFAULT ''manual'',
      workflow_session_id VARCHAR(36),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number),
      INDEX idx_feature_id (feature_id),
      INDEX idx_epic_id (epic_id),
      INDEX idx_workflow_session (workflow_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Add missing columns to sdlc_backlog_items if table exists
CALL AddColumnIfNotExists('sdlc_backlog_items', 'feature_id', "VARCHAR(36)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'epic_id', "VARCHAR(36)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'persona', "VARCHAR(255)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'persona_id', "VARCHAR(36)");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'acceptance_criteria', "JSON");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'subtasks', "JSON");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'source', "VARCHAR(50) DEFAULT 'manual'");
CALL AddColumnIfNotExists('sdlc_backlog_items', 'workflow_session_id', "VARCHAR(36)");

-- SDLC Documents table
CALL CreateTableIfNotExists('sdlc_documents',
    'CREATE TABLE sdlc_documents (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      title TEXT NOT NULL,
      content LONGTEXT,
      type TEXT NOT NULL DEFAULT ''general'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Design Assets table
CALL CreateTableIfNotExists('sdlc_design_assets',
    'CREATE TABLE sdlc_design_assets (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      file_url LONGTEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INT,
      thumbnail_url LONGTEXT,
      uploaded_by TEXT,
      source TEXT DEFAULT ''manual'',
      source_document_id VARCHAR(36),
      design_category TEXT,
      ado_work_item_id INT,
      ado_synced_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number),
      INDEX idx_design_category (design_category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- ADO Design Sync table
CALL CreateTableIfNotExists('ado_design_sync',
    'CREATE TABLE ado_design_sync (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL DEFAULT 2,
      last_sync_at TIMESTAMP,
      sync_status TEXT NOT NULL DEFAULT ''pending'',
      synced_items_count INT DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Figma Links table
CALL CreateTableIfNotExists('sdlc_figma_links',
    'CREATE TABLE sdlc_figma_links (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      figma_url TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT ''view'',
      created_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Design Reviews table
CALL CreateTableIfNotExists('sdlc_design_reviews',
    'CREATE TABLE sdlc_design_reviews (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      phase_number INT NOT NULL,
      design_asset_id VARCHAR(36),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT ''pending'',
      reviewed_by TEXT,
      comments TEXT,
      review_date TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_phase (project_id, phase_number),
      INDEX idx_design_asset_id (design_asset_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Code table
CALL CreateTableIfNotExists('sdlc_code',
    'CREATE TABLE sdlc_code (
      id VARCHAR(36) PRIMARY KEY,
      repository_id VARCHAR(36) NOT NULL,
      branch_id VARCHAR(36) NOT NULL,
      content LONGTEXT NOT NULL,
      language TEXT NOT NULL DEFAULT ''typescript'',
      file_name TEXT,
      file_path TEXT,
      generated_from TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_repository_branch (repository_id, branch_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Commits table
CALL CreateTableIfNotExists('sdlc_commits',
    'CREATE TABLE sdlc_commits (
      id VARCHAR(36) PRIMARY KEY,
      repository_id VARCHAR(36) NOT NULL,
      branch_id VARCHAR(36) NOT NULL,
      message TEXT NOT NULL,
      commit_number INT NOT NULL DEFAULT 1,
      author TEXT NOT NULL DEFAULT ''System'',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_repository_branch (repository_id, branch_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- SDLC Previews table
CALL CreateTableIfNotExists('sdlc_previews',
    'CREATE TABLE sdlc_previews (
      id VARCHAR(36) PRIMARY KEY,
      repository_id VARCHAR(36) NOT NULL,
      branch_id VARCHAR(36) NOT NULL,
      status TEXT NOT NULL DEFAULT ''active'',
      preview_url TEXT,
      code_status TEXT NOT NULL DEFAULT ''generated'',
      commit_count INT NOT NULL DEFAULT 1,
      last_commit_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_repository_branch (repository_id, branch_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- ============================================
-- Workflow Artifacts Tables
-- ============================================

-- Workflow Artifacts table
CALL CreateTableIfNotExists('workflow_artifacts',
    'CREATE TABLE workflow_artifacts (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36) NOT NULL,
      project_id VARCHAR(255),
      requirement LONGTEXT NOT NULL,
      guidelines LONGTEXT,
      epics JSON NOT NULL,
      features JSON NOT NULL,
      user_stories JSON NOT NULL,
      personas JSON NOT NULL,
      wiki_pages JSON NOT NULL,
      figma_guidelines LONGTEXT,
      status VARCHAR(50) NOT NULL DEFAULT ''draft'',
      modified TINYINT(1) DEFAULT 0,
      approval_status VARCHAR(20),
      modified_count INT DEFAULT 0,
      total_count INT DEFAULT 0,
      modified_items JSON NOT NULL DEFAULT (CAST('{\"epics\":[],\"features\":[],\"userStories\":[]}' AS JSON)),
      created_by VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_session_id (session_id),
      INDEX idx_project_id (project_id),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- Add missing columns to workflow_artifacts if table exists
CALL AddColumnIfNotExists('workflow_artifacts', 'modified', "TINYINT(1) DEFAULT 0");
CALL AddColumnIfNotExists('workflow_artifacts', 'approval_status', "VARCHAR(20)");
CALL AddColumnIfNotExists('workflow_artifacts', 'modified_count', "INT DEFAULT 0");
CALL AddColumnIfNotExists('workflow_artifacts', 'total_count', "INT DEFAULT 0");
CALL AddColumnIfNotExists('workflow_artifacts', 'modified_items', "JSON NOT NULL DEFAULT (CAST('{\"epics\":[],\"features\":[],\"userStories\":[]}' AS JSON))");

-- Update existing rows to have default modified_items if they are NULL
UPDATE workflow_artifacts 
SET modified_items = CAST('{"epics":[],"features":[],"userStories":[]}' AS JSON)
WHERE modified_items IS NULL;

-- Workflow Subtasks table
CALL CreateTableIfNotExists('workflow_subtasks',
    'CREATE TABLE workflow_subtasks (
      id VARCHAR(36) PRIMARY KEY,
      artifact_id VARCHAR(36) NOT NULL,
      user_story_id VARCHAR(36) NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      estimated_hours INT DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT ''pending'',
      assigned_to VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_artifact_id (artifact_id),
      INDEX idx_user_story_id (user_story_id),
      INDEX idx_status (status),
      FOREIGN KEY (artifact_id) REFERENCES workflow_artifacts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

-- ============================================
-- Re-enable foreign key checks
-- ============================================
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================
-- Verification Queries
-- ============================================
SELECT 'Schema migration completed. Verifying schema...' AS status;

-- Show all tables
SELECT TABLE_NAME, TABLE_ROWS 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;

-- Show table count
SELECT COUNT(*) AS total_tables
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_TYPE = 'BASE TABLE';

-- ============================================
-- Cleanup helper procedures
-- ============================================
DROP PROCEDURE IF EXISTS AddColumnIfNotExists;
DROP PROCEDURE IF EXISTS CreateTableIfNotExists;

SELECT 'Complete schema migration from QA to UAT completed successfully!' AS result;

-- Auto-generated migration for sdlc_projects
-- Generated at: 2026-04-15T08:42:00.241Z
-- Author: Schema Sync Tool

-- ============================================
-- Extra columns in database (review carefully!)
-- ============================================

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_projects DROP COLUMN IF EXISTS integration_type;

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_projects DROP COLUMN IF EXISTS jira_instance_url;

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_projects DROP COLUMN IF EXISTS jira_connection_id;

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_projects DROP COLUMN IF EXISTS jira_project_key;

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_projects DROP COLUMN IF EXISTS work_items_available;

-- ============================================
-- Verification queries
-- ============================================

-- Verify table structure
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sdlc_projects'
ORDER BY ORDINAL_POSITION;

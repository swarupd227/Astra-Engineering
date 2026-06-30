-- Auto-generated migration for sdlc_backlog_items
-- Generated at: 2026-04-15T08:42:00.217Z
-- Author: Schema Sync Tool

-- ============================================
-- Extra columns in database (review carefully!)
-- ============================================

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_backlog_items DROP COLUMN IF EXISTS jira_synced_at;

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_backlog_items DROP COLUMN IF EXISTS jira_pushed_at;

-- ⚠️  WARNING: Review before uncommenting!
-- ALTER TABLE sdlc_backlog_items DROP COLUMN IF EXISTS jira_issue_id;

-- ============================================
-- Verification queries
-- ============================================

-- Verify table structure
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sdlc_backlog_items'
ORDER BY ORDINAL_POSITION;

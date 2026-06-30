-- Add project_id and organization_id to crawl_runs if missing.
-- Safe to re-run: duplicate column errors are ignored by the migration runner.
ALTER TABLE crawl_runs ADD COLUMN project_id VARCHAR(36);
ALTER TABLE crawl_runs ADD COLUMN organization_id VARCHAR(36);

-- Idempotent repair: integrations table must match Drizzle (organization_id, project_id).
-- Legacy create-integrations-table.sql omitted these columns; baseline CREATE IF NOT EXISTS does not alter existing tables.

SET @db := DATABASE();

SELECT COUNT(*) INTO @has_integrations
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'integrations';

SELECT COUNT(*) INTO @has_org_col
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'integrations' AND COLUMN_NAME = 'organization_id';

SELECT COUNT(*) INTO @has_project_col
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'integrations' AND COLUMN_NAME = 'project_id';

SET @add_org := IF(
  @has_integrations > 0 AND @has_org_col = 0,
  'ALTER TABLE `integrations` ADD COLUMN `organization_id` VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @add_org;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_project := IF(
  @has_integrations > 0 AND @has_project_col = 0,
  'ALTER TABLE `integrations` ADD COLUMN `project_id` VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @add_project;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

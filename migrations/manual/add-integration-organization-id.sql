-- Add organization-level scoping support for third-party integrations (idempotent)
SET @db := DATABASE();

SELECT COUNT(*) INTO @has_col
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'integrations' AND COLUMN_NAME = 'organization_id';

SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE `integrations` ADD COLUMN `organization_id` VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

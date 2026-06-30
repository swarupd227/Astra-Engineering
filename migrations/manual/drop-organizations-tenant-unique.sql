-- Allow a tenant to own multiple organizations.
-- Older generated baselines created UNIQUE KEY tenant_id on organizations,
-- which breaks Jira/ADO organization visibility sync after the first org.

SET @index_name := (
  SELECT INDEX_NAME
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'organizations'
    AND COLUMN_NAME = 'tenant_id'
    AND NON_UNIQUE = 0
  GROUP BY INDEX_NAME
  HAVING COUNT(*) = 1
  LIMIT 1
);

SET @ddl := IF(
  @index_name IS NULL,
  'SELECT "organizations.tenant_id unique index not present" AS status',
  CONCAT('ALTER TABLE organizations DROP INDEX `', REPLACE(@index_name, '`', '``'), '`')
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

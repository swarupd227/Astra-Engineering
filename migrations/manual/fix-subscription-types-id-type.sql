-- Legacy QA DBs created from 01_schema_new1.sql use subscription_types.id INT AUTO_INCREMENT.
-- Baseline 00_full_schema.sql expects char(36) and CREATE TABLE IF NOT EXISTS skips the existing
-- subscription_types table, then fails creating subscriptions (fk_subscription_type incompatible).
-- Convert INT ids to char(36) UUIDs before baseline runs (idempotent — no-op when already char(36)).

SET @db := DATABASE();

SELECT COUNT(*) INTO @tbl_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscription_types';

SELECT DATA_TYPE INTO @id_type
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db
  AND TABLE_NAME = 'subscription_types'
  AND COLUMN_NAME = 'id'
LIMIT 1;

SET @needs_fix := (
  @tbl_exists > 0
  AND @id_type IN ('int', 'tinyint', 'smallint', 'mediumint', 'bigint')
);

SELECT COUNT(*) INTO @subs_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscriptions';

SELECT COUNT(*) INTO @fk_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = @db
  AND TABLE_NAME = 'subscriptions'
  AND CONSTRAINT_NAME = 'fk_subscription_type'
  AND CONSTRAINT_TYPE = 'FOREIGN KEY';

SELECT COUNT(*) INTO @has_uuid_col
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db
  AND TABLE_NAME = 'subscription_types'
  AND COLUMN_NAME = 'id_uuid';

SET @disable_fk := IF(@needs_fix = 1, 'SET FOREIGN_KEY_CHECKS = 0', 'SELECT 1');
PREPARE _stmt FROM @disable_fk;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @drop_fk := IF(
  @needs_fix = 1 AND @subs_exists > 0 AND @fk_exists > 0,
  'ALTER TABLE `subscriptions` DROP FOREIGN KEY `fk_subscription_type`',
  'SELECT 1'
);
PREPARE _stmt FROM @drop_fk;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_uuid_col := IF(
  @needs_fix = 1 AND @has_uuid_col = 0,
  'ALTER TABLE `subscription_types` ADD COLUMN `id_uuid` CHAR(36) NULL AFTER `id`',
  'SELECT 1'
);
PREPARE _stmt FROM @add_uuid_col;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @fill_uuid := IF(
  @needs_fix = 1,
  'UPDATE `subscription_types` SET `id_uuid` = UUID() WHERE `id_uuid` IS NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @fill_uuid;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @patch_subs := IF(
  @needs_fix = 1 AND @subs_exists > 0,
  'UPDATE `subscriptions` AS s
   INNER JOIN `subscription_types` AS st
     ON s.`subscription_type_id` = CAST(st.`id` AS CHAR)
     OR s.`subscription_type_id` = CONCAT('''', st.`id`)
   SET s.`subscription_type_id` = st.`id_uuid`',
  'SELECT 1'
);
PREPARE _stmt FROM @patch_subs;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @drop_auto_inc := IF(
  @needs_fix = 1,
  'ALTER TABLE `subscription_types` MODIFY `id` INT NOT NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @drop_auto_inc;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @drop_pk := IF(
  @needs_fix = 1,
  'ALTER TABLE `subscription_types` DROP PRIMARY KEY',
  'SELECT 1'
);
PREPARE _stmt FROM @drop_pk;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @drop_old_id := IF(
  @needs_fix = 1,
  'ALTER TABLE `subscription_types` DROP COLUMN `id`',
  'SELECT 1'
);
PREPARE _stmt FROM @drop_old_id;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @rename_uuid := IF(
  @needs_fix = 1,
  'ALTER TABLE `subscription_types` CHANGE COLUMN `id_uuid` `id` CHAR(36) NOT NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @rename_uuid;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_pk := IF(
  @needs_fix = 1,
  'ALTER TABLE `subscription_types` ADD PRIMARY KEY (`id`)',
  'SELECT 1'
);
PREPARE _stmt FROM @add_pk;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @enable_fk := IF(@needs_fix = 1, 'SET FOREIGN_KEY_CHECKS = 1', 'SELECT 1');
PREPARE _stmt FROM @enable_fk;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

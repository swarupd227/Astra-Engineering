-- Ask Astra chat tables: Drizzle uses PascalCase (ConversationTitles, ConversationSummary, Messages).
-- Baseline 00_full_schema.sql created lowercase names; on Linux (lower_case_table_names=0) the app
-- cannot find PascalCase tables. CREATE TABLE IF NOT EXISTS in create-conversation-titles-table.sql
-- does not rename existing tables — it only adds duplicates when case differs.
--
-- This migration: drop empty PascalCase shells if both exist, then RENAME lowercase → PascalCase.
-- It is only needed when MySQL table names are case-sensitive (lower_case_table_names=0).

SET @db := DATABASE();
SET @case_sensitive_tables := (@@lower_case_table_names = 0);

SELECT COUNT(*) INTO @has_lower_titles
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'conversationtitles';

SELECT COUNT(*) INTO @has_pascal_titles
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'ConversationTitles';

SELECT COUNT(*) INTO @has_lower_summary
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'conversationsummary';

SELECT COUNT(*) INTO @has_pascal_summary
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'ConversationSummary';

SELECT COUNT(*) INTO @has_lower_messages
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'messages';

SELECT COUNT(*) INTO @has_pascal_messages
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'Messages';

SET @both_titles := (@has_lower_titles > 0 AND @has_pascal_titles > 0);
SET @both_summary := (@has_lower_summary > 0 AND @has_pascal_summary > 0);
SET @both_messages := (@has_lower_messages > 0 AND @has_pascal_messages > 0);

SET @drop_msgs := IF(@both_messages = 1, 'DROP TABLE IF EXISTS `Messages`', 'SELECT 1');
PREPARE _stmt FROM @drop_msgs;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @drop_summary := IF(@both_summary = 1, 'DROP TABLE IF EXISTS `ConversationSummary`', 'SELECT 1');
PREPARE _stmt FROM @drop_summary;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @drop_titles := IF(@both_titles = 1, 'DROP TABLE IF EXISTS `ConversationTitles`', 'SELECT 1');
PREPARE _stmt FROM @drop_titles;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @rename_titles := IF(
  @has_lower_titles > 0 AND (@has_pascal_titles = 0 OR @both_titles = 1),
  'RENAME TABLE `conversationtitles` TO `ConversationTitles`',
  'SELECT 1'
);
PREPARE _stmt FROM @rename_titles;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @rename_summary := IF(
  @has_lower_summary > 0 AND (@has_pascal_summary = 0 OR @both_summary = 1),
  'RENAME TABLE `conversationsummary` TO `ConversationSummary`',
  'SELECT 1'
);
PREPARE _stmt FROM @rename_summary;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @rename_messages := IF(
  @has_lower_messages > 0 AND (@has_pascal_messages = 0 OR @both_messages = 1),
  'RENAME TABLE `messages` TO `Messages`',
  'SELECT 1'
);
PREPARE _stmt FROM @rename_messages;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

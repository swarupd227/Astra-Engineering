-- Idempotent repair: Ask Astra chat tables must exist as ConversationTitles (PascalCase).
-- Handles: missing tables, legacy lowercase names, duplicate shells from partial migrations.

SET @db := DATABASE();
SET @case_sensitive_tables := (@@lower_case_table_names = 0);

SELECT COUNT(*) INTO @has_lower_titles
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'conversationtitles';

SELECT COUNT(*) INTO @has_pascal_titles
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db
  AND (
    (@case_sensitive_tables = 1 AND TABLE_NAME = BINARY 'ConversationTitles')
    OR (@case_sensitive_tables = 0 AND LOWER(TABLE_NAME) = 'conversationtitles')
  );

SELECT COUNT(*) INTO @has_lower_summary
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'conversationsummary';

SELECT COUNT(*) INTO @has_pascal_summary
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db
  AND (
    (@case_sensitive_tables = 1 AND TABLE_NAME = BINARY 'ConversationSummary')
    OR (@case_sensitive_tables = 0 AND LOWER(TABLE_NAME) = 'conversationsummary')
  );

SELECT COUNT(*) INTO @has_lower_messages
FROM information_schema.TABLES
WHERE @case_sensitive_tables = 1
  AND TABLE_SCHEMA = @db
  AND TABLE_NAME = BINARY 'messages';

SELECT COUNT(*) INTO @has_pascal_messages
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db
  AND (
    (@case_sensitive_tables = 1 AND TABLE_NAME = BINARY 'Messages')
    OR (@case_sensitive_tables = 0 AND LOWER(TABLE_NAME) = 'messages')
  );

SET @need_create := (
  @has_lower_titles = 0 AND @has_pascal_titles = 0
);

SET @create_titles := IF(
  @need_create = 1,
  'CREATE TABLE `ConversationTitles` (
    `conversation_id` varchar(36) NOT NULL,
    `user_id` varchar(50) NOT NULL,
    `title` varchar(255) NOT NULL,
    `created_at` bigint NOT NULL,
    `updated_at` bigint NOT NULL,
    PRIMARY KEY (`conversation_id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
  'SELECT 1'
);
PREPARE _stmt FROM @create_titles;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @create_summary := IF(
  @need_create = 1,
  'CREATE TABLE `ConversationSummary` (
    `conversation_id` varchar(36) NOT NULL,
    `summary` text,
    `created_at` bigint NOT NULL,
    `updated_at` bigint NOT NULL,
    PRIMARY KEY (`conversation_id`),
    CONSTRAINT `fk_conv_summary_titles_ensure` FOREIGN KEY (`conversation_id`)
      REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
  'SELECT 1'
);
PREPARE _stmt FROM @create_summary;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @create_messages := IF(
  @need_create = 1,
  'CREATE TABLE `Messages` (
    `id` varchar(36) NOT NULL,
    `conversation_id` varchar(36) NOT NULL,
    `role` enum(''user'',''assistant'',''system'') NOT NULL,
    `content` text NOT NULL,
    `created_at` bigint NOT NULL,
    `is_summarised` tinyint(1) DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `fk_messages_conv_titles_ensure` (`conversation_id`),
    CONSTRAINT `fk_messages_conv_titles_ensure` FOREIGN KEY (`conversation_id`)
      REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
  'SELECT 1'
);
PREPARE _stmt FROM @create_messages;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

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

-- Create summary/messages if titles exist but children are missing (partial drift)
SELECT COUNT(*) INTO @has_pascal_titles
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db
  AND (
    (@case_sensitive_tables = 1 AND TABLE_NAME = BINARY 'ConversationTitles')
    OR (@case_sensitive_tables = 0 AND LOWER(TABLE_NAME) = 'conversationtitles')
  );

SELECT COUNT(*) INTO @has_pascal_summary
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db
  AND (
    (@case_sensitive_tables = 1 AND TABLE_NAME = BINARY 'ConversationSummary')
    OR (@case_sensitive_tables = 0 AND LOWER(TABLE_NAME) = 'conversationsummary')
  );

SELECT COUNT(*) INTO @has_pascal_messages
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db
  AND (
    (@case_sensitive_tables = 1 AND TABLE_NAME = BINARY 'Messages')
    OR (@case_sensitive_tables = 0 AND LOWER(TABLE_NAME) = 'messages')
  );

SET @create_summary2 := IF(
  @has_pascal_titles > 0 AND @has_pascal_summary = 0,
  'CREATE TABLE `ConversationSummary` (
    `conversation_id` varchar(36) NOT NULL,
    `summary` text,
    `created_at` bigint NOT NULL,
    `updated_at` bigint NOT NULL,
    PRIMARY KEY (`conversation_id`),
    CONSTRAINT `fk_conv_summary_titles_ensure2` FOREIGN KEY (`conversation_id`)
      REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
  'SELECT 1'
);
PREPARE _stmt FROM @create_summary2;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @create_messages2 := IF(
  @has_pascal_titles > 0 AND @has_pascal_messages = 0,
  'CREATE TABLE `Messages` (
    `id` varchar(36) NOT NULL,
    `conversation_id` varchar(36) NOT NULL,
    `role` enum(''user'',''assistant'',''system'') NOT NULL,
    `content` text NOT NULL,
    `created_at` bigint NOT NULL,
    `is_summarised` tinyint(1) DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `fk_messages_conv_titles_ensure2` (`conversation_id`),
    CONSTRAINT `fk_messages_conv_titles_ensure2` FOREIGN KEY (`conversation_id`)
      REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
  'SELECT 1'
);
PREPARE _stmt FROM @create_messages2;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

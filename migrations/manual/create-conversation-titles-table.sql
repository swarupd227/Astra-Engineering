-- Create PascalCase chat/conversation tables required by Ask Astra (Drizzle schema).
-- Greenfield: baseline/00_full_schema.sql now uses these names.
-- Upgrades: manual/fix-conversation-tables-case.sql renames legacy lowercase tables.

CREATE TABLE IF NOT EXISTS `ConversationTitles` (
  `conversation_id` varchar(36) NOT NULL,
  `user_id` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ConversationSummary` (
  `conversation_id` varchar(36) NOT NULL,
  `summary` text,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`conversation_id`),
  CONSTRAINT `fk_conv_summary_titles` FOREIGN KEY (`conversation_id`)
    REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `Messages` (
  `id` varchar(36) NOT NULL,
  `conversation_id` varchar(36) NOT NULL,
  `role` enum('user','assistant','system') NOT NULL,
  `content` text NOT NULL,
  `created_at` bigint NOT NULL,
  `is_summarised` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `fk_messages_conv_titles` (`conversation_id`),
  CONSTRAINT `fk_messages_conv_titles` FOREIGN KEY (`conversation_id`)
    REFERENCES `ConversationTitles` (`conversation_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

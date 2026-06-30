-- ============================================
-- Split Migration Script - Part 1 of 3
-- ============================================
-- If the full script is too large for Azure Query Editor,
-- run these parts sequentially
-- ============================================

-- Part 1: Helper Procedures and Core Tables
-- Run this first

SET FOREIGN_KEY_CHECKS = 0;

DELIMITER $$

DROP PROCEDURE IF EXISTS AddColumnIfNotExists$$
CREATE PROCEDURE AddColumnIfNotExists(
    IN table_name VARCHAR(255),
    IN column_name VARCHAR(255),
    IN column_definition TEXT
)
BEGIN
    DECLARE column_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO column_count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name
      AND COLUMN_NAME = column_name;
    
    IF column_count = 0 THEN
        SET @sql = CONCAT('ALTER TABLE `', table_name, '` ADD COLUMN `', column_name, '` ', column_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column: ', table_name, '.', column_name) AS result;
    ELSE
        SELECT CONCAT('Column already exists: ', table_name, '.', column_name) AS result;
    END IF;
END$$

DROP PROCEDURE IF EXISTS CreateTableIfNotExists$$
CREATE PROCEDURE CreateTableIfNotExists(
    IN table_name VARCHAR(255),
    IN create_statement TEXT
)
BEGIN
    DECLARE table_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO table_count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name;
    
    IF table_count = 0 THEN
        SET @sql = create_statement;
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Created table: ', table_name) AS result;
    ELSE
        SELECT CONCAT('Table already exists: ', table_name) AS result;
    END IF;
END$$

DELIMITER ;

-- Core tables (users, organizations, projects, etc.)
-- Continue with CREATE TABLE statements from main script...

-- Note: This is a template. Copy the relevant sections from 
-- qa-to-uat-schema-migration.sql and split into 2-3 parts
-- if needed for Azure Query Editor size limits.


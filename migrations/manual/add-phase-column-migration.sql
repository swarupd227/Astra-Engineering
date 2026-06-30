-- Migration: Add phase column to wiki_pages table
-- MySQL disallows DEFAULT on TEXT/BLOB/JSON — use VARCHAR instead.

SET @db := DATABASE();

SELECT COUNT(*) INTO @has_phase
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db
  AND TABLE_NAME = 'wiki_pages'
  AND COLUMN_NAME = 'phase';

SET @add_phase := IF(
  @has_phase = 0,
  'ALTER TABLE `wiki_pages`
     ADD COLUMN `phase` VARCHAR(64) NOT NULL DEFAULT ''reference''
     COMMENT ''SDLC phase: planning, requirements, design, implementation, testing, deployment, reference''
     AFTER `page_type`',
  'SELECT 1'
);
PREPARE _stmt FROM @add_phase;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

UPDATE `wiki_pages` SET `phase` = 'planning' WHERE `page_type` IN ('overview', 'feasibility-study', 'risk-assessment');
UPDATE `wiki_pages` SET `phase` = 'requirements' WHERE `page_type` IN ('business-requirements', 'srs', 'use-cases', 'rtm', 'use-case-diagram', 'dfd');
UPDATE `wiki_pages` SET `phase` = 'design' WHERE `page_type` IN ('technical-architecture', 'system-design', 'ui-ux-design', 'database-design', 'class-diagram', 'sequence-diagram', 'component-diagram', 'data-models');
UPDATE `wiki_pages` SET `phase` = 'implementation' WHERE `page_type` IN ('features', 'api', 'coding-standards', 'version-control', 'infrastructure-diagram');
UPDATE `wiki_pages` SET `phase` = 'testing' WHERE `page_type` IN ('testing', 'test-plan', 'test-cases', 'test-coverage-matrix');
UPDATE `wiki_pages` SET `phase` = 'deployment' WHERE `page_type` IN ('deployment', 'release-notes', 'user-manual', 'maintenance-plan');
UPDATE `wiki_pages` SET `phase` = 'reference' WHERE `page_type` IN ('glossary', 'security', 'workflows', 'personas');

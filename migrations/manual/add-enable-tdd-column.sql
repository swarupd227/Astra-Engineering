-- Add enable_tdd column to sdlc_projects table for project-level TDD preference

ALTER TABLE sdlc_projects
ADD COLUMN enable_tdd BOOLEAN DEFAULT FALSE;

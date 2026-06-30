-- Add linked_golden_repo_name column to sdlc_projects (idempotent).
ALTER TABLE sdlc_projects ADD COLUMN linked_golden_repo_name TEXT NULL;

-- Add golden_repo_reference JSON column to sdlc_projects (idempotent).
ALTER TABLE sdlc_projects
  ADD COLUMN golden_repo_reference JSON NULL
  COMMENT 'Stores selected file paths from linked golden repository';

-- Add idempotency and version tracking columns to sdlc_specs_files
-- Add generation mutex lock to sdlc_projects

ALTER TABLE sdlc_specs_files
  ADD COLUMN input_hash VARCHAR(64) NULL,
  ADD COLUMN spec_version INT NOT NULL DEFAULT 1;

ALTER TABLE sdlc_projects
  ADD COLUMN is_generating BOOLEAN NOT NULL DEFAULT FALSE;

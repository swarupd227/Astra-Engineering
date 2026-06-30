-- Migration: add-sdlc-project-owner-user-id
-- Created: 2026-06-07
-- Description: Add owner_user_id to SDLC projects for creator/importer ownership checks.

ALTER TABLE sdlc_projects
  ADD COLUMN owner_user_id VARCHAR(36) NULL;

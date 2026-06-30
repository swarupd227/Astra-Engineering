-- Add golden repository organization and project columns to sdlc_projects table

ALTER TABLE sdlc_projects 
ADD COLUMN linked_golden_repo_org TEXT,
ADD COLUMN linked_golden_repo_project TEXT;


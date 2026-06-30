-- Add content_hash and repo_commit_id columns for repo sync tracking

ALTER TABLE sdlc_specs_files ADD COLUMN content_hash VARCHAR(64) DEFAULT NULL;
ALTER TABLE sdlc_specs_files ADD COLUMN repo_commit_id VARCHAR(40) DEFAULT NULL;

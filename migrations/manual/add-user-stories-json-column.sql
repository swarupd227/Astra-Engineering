-- Add user_stories_json column to store ADO user stories per feature

ALTER TABLE sdlc_specs_files ADD COLUMN user_stories_json JSON DEFAULT NULL;

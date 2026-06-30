-- Add requirement_ids JSON column to workflow_artifacts (idempotent).
ALTER TABLE workflow_artifacts ADD COLUMN requirement_ids JSON AFTER brd_id;

UPDATE workflow_artifacts SET requirement_ids = JSON_ARRAY() WHERE requirement_ids IS NULL;

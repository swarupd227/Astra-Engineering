-- Allow dom_hash to be NULL (no default required)
ALTER TABLE page_dom_versions MODIFY COLUMN dom_hash VARCHAR(64) NULL DEFAULT NULL;

-- Allow page_signature_hash to be NULL (no default required)
ALTER TABLE automated_test_pages MODIFY COLUMN page_signature_hash VARCHAR(64) NULL DEFAULT NULL;

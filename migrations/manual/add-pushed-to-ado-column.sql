-- Add pushed_to_ado column to sdlc_specs_files table to track push status

ALTER TABLE sdlc_specs_files
ADD COLUMN pushed_to_ado BOOLEAN DEFAULT FALSE NOT NULL;

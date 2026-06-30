-- Add MFA columns to users table (idempotent — duplicate column errors ignored by runner).
ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE users ADD COLUMN is_mfa_enabled BOOLEAN NOT NULL DEFAULT false;

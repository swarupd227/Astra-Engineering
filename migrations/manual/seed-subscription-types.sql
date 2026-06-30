-- Seed subscription_types with DEFAULT type (required for tenant subscriptions)
-- Run this once to pre-populate. The app no longer auto-inserts into subscription_types.
-- Idempotent: safe to run multiple times.

INSERT INTO subscription_types (code, name, description, is_active)
VALUES ('DEFAULT', 'Default Subscription', 'Initial subscription with all features enabled', 1)
ON DUPLICATE KEY UPDATE code = code;

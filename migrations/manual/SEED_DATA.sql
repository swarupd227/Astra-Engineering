-- =============================================================================
-- DevX / Astra Platform — Reference seed data (idempotent where possible)
-- =============================================================================
-- Run ONLY on a database that already has the full schema applied.
-- Replace placeholder UUIDs and hashes with values from your environment.
--
-- Recommended order:
--   1. subscription_types
--   2. roles
--   3. tenants (if using multi-tenant license model)
--   4. license_keys
--   5. subscriptions
--   6. users / user_roles (via app login or admin scripts)
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. subscription_types (required before subscriptions)
-- Source: migrations/manual/seed-subscription-types.sql
-- -----------------------------------------------------------------------------
INSERT INTO subscription_types (code, name, description, is_active)
VALUES ('DEFAULT', 'Default Subscription', 'Initial subscription with all features enabled', 1)
ON DUPLICATE KEY UPDATE code = code;

-- Optional: Standard tier (from Provision_7_04_2026.sql — adjust id if using auto-increment)
-- INSERT INTO subscription_types (id, code, name, description, is_active, created_at)
-- VALUES (
--   'b0808d1e-05a2-11f1-96aa-002248d629a7',
--   'Standard',
--   'Standard Subscription',
--   'Full access subscription with all DevX features enabled',
--   1,
--   NOW()
-- ) ON DUPLICATE KEY UPDATE code = code;

-- -----------------------------------------------------------------------------
-- 2. roles (RBAC — required for role assignment)
-- Source: migrations/auto-generated/Provision_7_04_2026.sql
-- -----------------------------------------------------------------------------
INSERT INTO roles (id, name) VALUES
  (1, 'TenantAdmin'),
  (2, 'OrgAdmin'),
  (3, 'ProjectAdmin'),
  (4, 'BusinessAnalyst'),
  (5, 'Developer'),
  (6, 'Approver'),
  (7, 'Viewer'),
  (8, 'BA')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- -----------------------------------------------------------------------------
-- 3. tenants (example — generate your own UUIDs in production)
-- -----------------------------------------------------------------------------
-- INSERT INTO tenants (id, name, status, created_at)
-- VALUES (
--   '5a6c876c-f971-4b14-91e5-b14f89bb031d',
--   'Your Organization',
--   'active',
--   NOW()
-- ) ON DUPLICATE KEY UPDATE name = VALUES(name);

-- -----------------------------------------------------------------------------
-- 4. license_keys (example — DO NOT copy hashes from another environment)
-- Generate via application license tooling or your internal process.
-- -----------------------------------------------------------------------------
-- INSERT INTO license_keys (tenant_id, license_hash, salt, integrity_hash, created_at)
-- VALUES (
--   'YOUR-TENANT-UUID',
--   'REPLACE_WITH_LICENSE_HASH',
--   'REPLACE_WITH_SALT',
--   'REPLACE_WITH_INTEGRITY_HASH',
--   NOW()
-- );

-- -----------------------------------------------------------------------------
-- 5. subscriptions (links tenant to subscription_types)
-- subscription_type_id must match subscription_types.id (int or varchar per your schema)
-- -----------------------------------------------------------------------------
-- INSERT INTO subscriptions (
--   id, tenant_id, subscription_type_id, max_users,
--   start_date, expiry_date, is_active, created_at
-- ) VALUES (
--   UUID(),
--   'YOUR-TENANT-UUID',
--   (SELECT id FROM subscription_types WHERE code = 'DEFAULT' LIMIT 1),
--   50,
--   CURDATE(),
--   DATE_ADD(CURDATE(), INTERVAL 1 YEAR),
--   1,
--   NOW()
-- );

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- Verification queries
-- -----------------------------------------------------------------------------
-- SELECT * FROM subscription_types;
-- SELECT * FROM roles ORDER BY id;
-- SELECT * FROM tenants;
-- SELECT * FROM subscriptions WHERE is_active = 1;
-- SELECT COUNT(*) AS table_count FROM information_schema.tables
--   WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';

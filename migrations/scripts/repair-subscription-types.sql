-- Repair subscription_types after seed without id (all rows collapsed to one bad row).
-- Run on qadevxdb_test (or client DB) then re-apply 02_seed.sql

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM `subscription_types` WHERE `id` = '' OR `id` IS NULL;

SET FOREIGN_KEY_CHECKS = 1;

-- Then run: npm run migrate:container with RUN_DB_SEED=true
-- Or paste the INSERT block from migrations/manual/02_seed.sql (subscription_types section)

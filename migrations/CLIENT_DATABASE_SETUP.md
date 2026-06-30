# Client Database Setup (Quick Reference)

**Full client handoff guide:** [docs/deployment/CLIENT_DATABASE_MIGRATION_GUIDE.md](../docs/deployment/CLIENT_DATABASE_MIGRATION_GUIDE.md)  
**Short client quick start:** [docs/deployment/CLIENT_DATABASE_QUICK_START.md](../docs/deployment/CLIENT_DATABASE_QUICK_START.md)

All **173 production tables** are in a single baseline file. Migrations run automatically on EKS deploy (Helm Job) or via `RUN_DB_MIGRATIONS=true`.
## What gets applied

| Phase | File | Purpose |
|-------|------|---------|
| **Full schema** | `baseline/00_full_schema.sql` | **Every table** (CREATE TABLE IF NOT EXISTS) |
| Incrementals | `manual/*.sql` (38 files) | Column/index patches after baseline |
| Seed (optional) | `manual/02_seed.sql` | Roles, subscription types, personas |

Order: `migrations/migration-order.json`

### Regenerate baseline from live DB (100% DDL match)

**Aurora QA cluster (reference):**

```env
MYSQL_HOST=devx-aurora-qa.cluster-cl2o06u2grip.ap-south-1.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_USER=<from Secrets Manager devx/platform/qa>
MYSQL_PASSWORD=<from Secrets Manager>
MYSQL_DATABASE=qadevxdb
```

Template: `migrations/config/aurora-qa.env.example`

When all `MYSQL_*` vars are set in `.env`:

```bash
npm run generate:full-schema
```

This runs `mysqldump --no-data` (or `SHOW CREATE TABLE`) and overwrites `baseline/00_full_schema.sql`.

Without DB access, the script merges all repo SQL + `05_prod_gap_tables.sql` (already done — see `baseline/SCHEMA_COVERAGE.json`).

## Option A — Helm / EKS (recommended)

1. Secret `devx-runtime-env` must include `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.
2. Default chart values:

```yaml
migrations:
  runAsJob: true
  seed: "true"
  strict: "true"
```

3. `helm upgrade --install` — migration Job runs **before** app pods.

## Option B — Docker entrypoint

```env
RUN_DB_MIGRATIONS=true
RUN_DB_SEED=true
```

Use with **one replica** only; prefer the Helm Job for production.

## Option C — Manual / CI

```bash
npm ci
RUN_DB_SEED=true npm run migrate:dev
npm run check:schema
```

## Verify

```sql
SELECT COUNT(*) AS tables_count
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
-- Expect 170+

SELECT migration_name, status FROM schema_migrations ORDER BY executed_at DESC LIMIT 10;
SELECT * FROM roles;
SELECT * FROM subscription_types;
```

## Brownfield

- Do **not** replace an existing DB with `00_full_schema` on top of live data without a plan.
- New SQL → `migrations/manual/` → `npm run migrate:order:generate` → deploy.
- Already-applied files are skipped via `schema_migrations`.

## Source files (reference only)

These are merged **into** `00_full_schema.sql` by `npm run generate:full-schema`:

- `manual/01_schema_new1.sql`
- `auto-generated/Provision_7_04_2026.sql`
- `auto-generated/1774252896099-qadevxdb-to-finacs_db-migration.sql`
- `baseline/04_qe_platform_extension.sql`
- `baseline/05_prod_gap_tables.sql`
- All other `migrations/**/*.sql` with CREATE TABLE

# Database documentation

Client-facing and developer reference for the DevX / Astra MySQL schema.

| File | Description |
|------|-------------|
| [DATABASE_REFERENCE.md](./DATABASE_REFERENCE.md) | **Main doc** — tables by domain, seeding, migrations, verification |
| [SEED_DATA.sql](../../migrations/manual/SEED_DATA.sql) | Runnable reference seed script (subscription types, roles) |
| [TABLES_MANIFEST.json](./TABLES_MANIFEST.json) | Table names extracted from Drizzle + Provision DDL |
| `../../migrations/auto-generated/Provision_7_04_2026.sql` | Full `CREATE TABLE` DDL + example seeds |
| `../../shared/schema.ts` | Application schema (Drizzle) |
| `../../shared/qe-schema.ts` | QE module schema (Drizzle) |


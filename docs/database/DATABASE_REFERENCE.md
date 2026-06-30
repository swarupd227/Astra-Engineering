# DevX / Astra Platform — Database Reference

Complete reference for **MySQL / Aurora MySQL** used by DevX 2.0: schema sources, all tables, seeding, migrations, and verification.

---

## Overview

DevX 2.0 uses **MySQL 8 / Aurora MySQL**. The database model is defined in application code and applied through SQL migrations.

| Layer | Role |
|-------|------|
| **`shared/schema.ts`** | Primary platform tables (tenants, SDLC, workflow, BRD, Jira, AI, etc.) |
| **`shared/qe-schema.ts`** | Quality Engineering / test automation tables |
| **`migrations/manual/*.sql`** | Incremental schema changes (applied via migration runner) |
| **`migrations/applied/*.sql`** | Idempotent baseline / environment migration scripts |
| **`migrations/auto-generated/Provision_7_04_2026.sql`** | Full `CREATE TABLE` DDL snapshot + reference seeds |

**Runtime configuration:** `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` — from `.env` (development) or AWS Secrets Manager when `DEVX_HOSTING=aws` (loaded at startup by `server/secrets-loader.ts`).

**New database setup:**

```bash
cp .env.example .env
# Set MYSQL_* (or AWS bootstrap + Secrets Manager for aws hosting)
npm ci
RUN_DB_SEED=true npm run migrate:dev
npm run check:schema
```

**EKS / Docker:** migrations run automatically when `RUN_DB_MIGRATIONS=true` (entrypoint) or via Helm `migrations.runAsJob: true`. See `migrations/CLIENT_DATABASE_SETUP.md`.

## Quick links

| Resource | Path |
|----------|------|
| **Application schema (Drizzle)** | `shared/schema.ts`, `shared/qe-schema.ts` |
| **Full DDL snapshot** | `migrations/auto-generated/Provision_7_04_2026.sql` |
| **Migration manifest (run order)** | `migrations/migration-order.json` |
| **Client greenfield guide** | `migrations/CLIENT_DATABASE_SETUP.md` |
| **Full prod baseline (all tables)** | `migrations/baseline/00_full_schema.sql` |
| **Regenerate baseline** | `npm run generate:full-schema` |
| **Coverage report** | `migrations/baseline/SCHEMA_COVERAGE.json` |
| **Legacy partial baselines** | `01_schema_new1.sql`, `04_qe_platform_extension.sql`, etc. (merged into 00) |
| **Incremental migrations** | `migrations/manual/*.sql` |
| **Reference seeds** | `migrations/manual/SEED_DATA.sql` |
| **Table names (from code)** | `docs/database/TABLES_MANIFEST.json` |
| **Migration guide** | `docs/guides/MIGRATION_GUIDE.md` |

---

## Connection

Set in `.env` or AWS Secrets Manager:

```env
MYSQL_HOST=your-cluster.region.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
```

Use **SSL** for Aurora/RDS in production.

---

## Schema sources

| Layer | Purpose |
|-------|---------|
| `shared/schema.ts` | Main platform tables used by the application |
| `shared/qe-schema.ts` | QE module tables (when QE features are enabled) |
| `migrations/manual/*.sql` | Additional tables and columns not yet in Drizzle (license, specs jobs, security scan, etc.) |
| `migrations/auto-generated/Provision_7_04_2026.sql` | Full `CREATE TABLE` DDL for core platform tables |
| `migrations/applied/qa-to-uat-schema-migration.sql` | Idempotent baseline (`CREATE TABLE IF NOT EXISTS` + `ALTER`) |

After all migrations run, the database includes **Drizzle-defined tables plus migration-only tables** (see section 13). Table names are listed in `docs/database/TABLES_MANIFEST.json` (regenerate: `node scripts/generate-database-reference.js`).

---

## System / migration tables

| Table | Purpose |
|-------|---------|
| `schema_migrations` | Tracks applied SQL migrations (`migration_name`, `executed_at`, `status`) |
| `__drizzle_migrations` | Drizzle-kit internal migration log (if used) |

---

## 1. Licensing, tenants & RBAC

| Table | Purpose |
|-------|---------|
| `tenants` | Multi-tenant root; org isolation |
| `subscription_types` | Plan catalog (`DEFAULT`, `Standard`, etc.) — **must be seeded** |
| `subscriptions` | Active plan per tenant (expiry, max users, token quota) |
| `license_keys` | Per-tenant license hashes (integrity validation) |
| `devx_license_keys` | Extended license key storage (migration) |
| `license_types` | License type definitions |
| `license_features` | Feature flags per license type |
| `license_metadata` | License metadata |
| `license_cache` | License validation cache |
| `license_audit_log` | License change audit trail |
| `feature_usage` | Feature usage tracking |
| `user_seats` | Seat allocation per tenant |
| `user_activity_logs` | User activity audit |
| `token_usage_logs` | AI/token consumption audit per tenant/user |
| `users` | Platform users (Azure OID, email, Cognito/GitHub provider, MFA, soft-delete) |
| `roles` | RBAC role names — **seed default roles** |
| `user_roles` | User ↔ role ↔ scope (org/project) |
| `role_activity_permissions` | Fine-grained activity flags per role/tenant |
| `audit_logs` | RBAC security events (role assign/remove, soft-delete) |
| `organizations` | Orgs within a tenant |
| `projects` | DevX projects linked to org / ADO / Jira |

---

## 2. Golden repos & Azure DevOps settings

| Table | Purpose |
|-------|---------|
| `golden_repositories` | Template / golden repo definitions |
| `golden_repo_organizations` | Org ↔ golden repo links |
| `ado_settings` | Azure DevOps connection settings per scope |
| `artifact_organizations` | Artifact hub org mapping |
| `conversational_ui_settings` | Conversational UI config |
| `workflow_settings` | Workflow engine defaults |
| `sdlc_settings` | SDLC module settings |
| `integration_settings` | Per-project integration type (`ado` / `jira`) |
| `integrations` | Integration catalog entries |
| `integration_tool_catalog` | Available integration tools catalog |
| `org_integration_configs` | Org-level integration configuration |
| `project_integration_configs` | Project-level integration configuration |
| `sdlc_project_tool_configs` | Per-project tool settings (SDLC) |
| `gitlab_settings` | GitLab connection settings |
| `ado_configurations` | QE: ADO test integration config |

---

## 3. SDLC — projects, phases, backlog

| Table | Purpose |
|-------|---------|
| `sdlc_projects` | SDLC project instances |
| `sdlc_phases` | Phases within a project |
| `phase_confirmations` | Phase sign-off / confirmation |
| `sdlc_epics` | Epics |
| `sdlc_features` | Features (workflow-linked) |
| `sdlc_requirements` | Requirements |
| `sdlc_backlog_items` | Stories/tasks/backlog (rich metadata, Figma, workflow session) |
| `sdlc_issues` | Issue tracking mirror |
| `sdlc_documents` | Generated / attached documents |
| `personas` | User personas for design/requirements |
| `wiki_pages` | Wiki content per project/phase |
| `sdlc_specs_files` | Spec documents stored in DB metadata |
| `specs_generation_jobs` | Async specs generation job queue |
| `brd_specs_drafts` | BRD/spec draft workspace |
| `brd_specs_draft_files` | Files attached to BRD/spec drafts |

---

## 4. SDLC — development, design, code

| Table | Purpose |
|-------|---------|
| `development_repositories` | Linked Git repos |
| `development_branches` | Branch metadata |
| `project_git_config` | Generic Git access config per project |
| `sdlc_design_assets` | Design assets |
| `sdlc_figma_links` | Figma URLs |
| `sdlc_design_reviews` | Design review records |
| `ado_design_sync` | ADO design sync state |
| `jira_design_sync` | Jira design sync (DB-only in some envs) |
| `design_mappings` | Design ↔ requirement mappings |
| `sdlc_code` | Code artifact metadata |
| `sdlc_commits` | Commit tracking |
| `sdlc_previews` | Preview environments |

---

## 5. Workflow & artifact generation

| Table | Purpose |
|-------|---------|
| `workflow_steps` | Workflow step definitions |
| `workflow_step1_data` | Step 1 persisted payload |
| `workflow_step2_data` | Step 2 persisted payload |
| `workflow_step3_data` | Step 3 persisted payload |
| `workflow_artifacts` | Generated epics/features/stories JSON |
| `workflow_subtasks` | Subtasks under artifacts |
| `workflow_test_cases` | Test cases from workflow |
| `workflow_brd_attachments` | BRD files attached to workflow |
| `workflow_attached_documents` | Extra attached docs (legacy naming) |
| `workflow_conversation_titles` | Workflow chat titles |
| `workflow_conversation_messages` | Workflow chat messages |
| `artifact_generation_jobs` | Async artifact generation jobs |
| `artifact_events` | Artifact lifecycle events |
| `ai_enhance_mappings` | AI enhancement mapping config |

---

## 6. BRD & test plans

| Table | Purpose |
|-------|---------|
| `brd_documents` | Business requirements documents |
| `brd_file_versions` | BRD file version history |
| `brd_generation_metrics` | BRD generation metrics / telemetry |
| `brd_generation_jobs` | Async BRD generation jobs |
| `dev_brd_documents` | Developer BRD workspace documents |
| `dev_brd_requirements` | Requirements extracted in dev BRD |
| `dev_brd_chat_history` | Dev BRD chat history |
| `dev_brd_file_versions` | Dev BRD file versions |
| `dev_brd_phase_progress` | Dev BRD phase progress |
| `dev_workflow_brd_attachments` | Dev BRD ↔ workflow links |
| `test_plan_documents` | Test plan documents |

---

## 7. AI, conversations & RAG

| Table | Purpose |
|-------|---------|
| `ConversationTitles` | Hub / Ask Astra conversation titles |
| `ConversationSummary` | Conversation summaries |
| `Messages` | Ask Astra chat messages |
| `ai_sessions` | AI session records |
| `session_states` | Session state snapshots |
| `ai_usage_logs` | Model usage logging |
| `session_cost_summaries` | Cost rollup per session |
| `msal_users` | Azure MSAL user cache |
| `design_guidelines` | Design guideline documents |
| `vectorized_guidelines` | Embeddings index metadata |
| `guideline_chunks` | Chunked guideline text |
| `devx_vectorized_guidelines` | DevX-specific vector index |
| `devx_guideline_chunks` | DevX guideline chunks |
| `rag_sessions` | RAG session tracking |
| `devx_rag_sessions` | Alternate RAG session table (some DBs) |
| `file_summary` | RAG file summaries |
| `message_summary` | RAG message summaries |

---

## 8. Crawl, DOM & automated testing (platform)

| Table | Purpose |
|-------|---------|
| `crawl_runs` | Site crawl jobs |
| `automated_test_pages` | Pages discovered for automation |
| `page_dom_versions` | DOM snapshots per page |
| `page_forms` | Forms detected on pages |
| `page_dom_elements` | DOM element catalog |
| `dom_actions` / `dom_forms` | DOM interaction metadata (some DBs) |
| `navigation_edges` | Site navigation graph edges |
| `automated_test_cases` | Generated test cases |
| `automated_test_scripts` | Playwright/script artifacts |
| `automated_test_runs` | Test run executions |
| `automated_test_results` | Per-step/case results |

---

## 9. Stack modernization

| Table | Purpose |
|-------|---------|
| `modernization_analyses` | Repo analysis runs |
| `modernization_phase_outputs` | Per-phase AI output |
| `modernization_version_changes` | Detected version upgrades |
| `modernization_token_usage` | Token usage for modernization |

---

## 10. Jira integration

| Table | Purpose |
|-------|---------|
| `jira_connections` | Jira connection records |
| `jira_settings` | Project-level Jira settings |
| `user_jira_credentials` | Per-user Jira tokens |
| `jira_action_logs` | Jira API action audit log |
| `jira_push_metadata` | Metadata for Jira push/sync operations |
| `jira_design_sync` | Jira design asset sync state (legacy; may be created by baseline migrations) |

---

## 11. Provisioning, security & notifications

| Table | Purpose |
|-------|---------|
| `provisioning_instances` | Cloud resource provisioning state |
| `security_scan_configs` | Security scan configuration per project |
| `security_scan_jobs` | Security scan job runs |
| `notifications` | In-app notifications |
| `client_feedback` | Client feedback submissions |

---

## 12. Quality Engineering (QE) module

Defined in `shared/qe-schema.ts`. Used by test management, execution, BDD, API testing, visual regression, etc.

| Table | Purpose |
|-------|---------|
| `test_sessions` | QE test sessions |
| `test_results` | Session results |
| `visual_diffs` | Visual comparison diffs |
| `auto_test_runs` | Automated test runs |
| `auto_test_pages` | Pages under auto test |
| `auto_test_cases` | Auto test cases |
| `auto_test_scripts` | Scripts |
| `auto_test_executions` | Execution records |
| `functional_test_sessions` | Functional test sessions |
| `workflows` | QE workflows |
| `test_cases` | Test case library |
| `execution_results` | Execution outcomes |
| `requirements` | QE requirements |
| `sprints` | Sprint planning |
| `user_stories` | User stories |
| `sprint_user_stories` | Sprint ↔ story mapping |
| `sprint_test_cases` | Sprint ↔ test case mapping |
| `functional_test_runs` | Functional run header |
| `functional_test_run_cases` | Cases in a functional run |
| `integration_configs` | QE integration config |
| `execution_runs` | Batch execution runs |
| `execution_run_tests` | Tests in execution run |
| `bdd_feature_files` | BDD feature files |
| `bdd_step_definitions` | Step definitions |
| `synthetic_data_jobs` | Synthetic data generation jobs |
| `visual_regression_baselines` | Visual baselines |
| `visual_regression_results` | Visual regression results |
| `accessibility_scan_results` | a11y scan results |
| `responsive_test_results` | Responsive layout tests |
| `report_validations` | Report validation jobs |
| `validation_results` | Validation outcomes |
| `api_baselines` | API test baselines |
| `api_baseline_executions` | API baseline runs |
| `jira_test_cases` | Jira-linked test cases |
| `automation_scripts` | Stored automation scripts |
| `api_discovery_runs` | API discovery runs |
| `har_captures` | HAR capture storage |
| `framework_configs` | Test framework config |
| `framework_functions` | Reusable framework functions |
| `framework_files` | Framework file blobs |

**Note:** QE tables are created when the QE module migrations run. Enable QE in your deployment if you use test automation features.

---

## 13. AI prompts & legacy / parallel tables

| Table | Purpose |
|-------|---------|
| `prompts` | Stored prompt templates |
| `prompt_logs` | Prompt execution logs |
| `dev_brd_chat_history` | Dev BRD chat history |
| `dev_brd_file_versions` | Dev BRD file version history |
| `dev_brd_phase_progress` | Dev BRD phase progress tracking |
| `dev_workflow_brd_attachments` | Dev BRD ↔ workflow links |
| `devx_rag_sessions` | DevX RAG session store (parallel to `rag_sessions` in some deployments) |
| `workflow_attached_documents` | Documents attached to workflows |
| `workflow_conversation_messages` | Workflow-scoped chat messages |
| `workflow_conversation_titles` | Workflow-scoped chat titles |
| `dom_actions` | DOM crawl action catalog |
| `dom_forms` | DOM form catalog (crawl) |
| `navigation_edges` | Site navigation graph |
| `file_summary` | RAG file summaries |
| `message_summary` | RAG message summaries |

**Naming note:** Chat tables must be `ConversationTitles`, `ConversationSummary`, `Messages` (PascalCase) to match Drizzle / Ask Astra. Legacy lowercase tables are renamed by `migrations/manual/fix-conversation-tables-case.sql`. Greenfield baseline uses PascalCase in `baseline/00_full_schema.sql`.

---

## Seeding guide

### What must be seeded (minimum)

| Data | Table(s) | Script |
|------|----------|--------|
| Subscription type | `subscription_types` | `migrations/manual/SEED_DATA.sql` or `migrations/manual/seed-subscription-types.sql` |
| RBAC roles | `roles` | `migrations/manual/SEED_DATA.sql` (from Provision seed block) |

Without `subscription_types`, tenant subscription flows can fail.

### What is usually created by the application

| Data | Table(s) | How |
|------|----------|-----|
| Users | `users` | First login via Cognito / Azure AD (`/api/auth/bootstrap-user`) |
| User roles | `user_roles` | Admin UI or bootstrap |
| Tenants | `tenants` | License / onboarding flow |
| Organizations & projects | `organizations`, `projects` | UI |

### Optional / environment-specific seeds

| File | Purpose |
|------|---------|
| `migrations/manual/seed-subscription-types.sql` | `DEFAULT` subscription type only |
| `migrations/auto-generated/Provision_7_04_2026.sql` (tail) | Example `subscription_types`, `roles`, `license_keys`, `subscriptions` with fixed UUIDs |
| `migrations/manual/SEED_DATA.sql` | Consolidated, commented, idempotent reference |

**Warning:** Do not copy `license_hash` / `salt` / `integrity_hash` from another environment. Generate license data through your license process.

### Recommended seed order

```
1. subscription_types
2. roles
3. tenants          (if needed)
4. license_keys     (if using license model)
5. subscriptions
6. users            (via app auth)
7. user_roles       (via admin)
```

### Run seeds

```bash
mysql -h $MYSQL_HOST -u $MYSQL_USER -p $MYSQL_DATABASE < migrations/manual/SEED_DATA.sql
```

Or run individual files under `migrations/manual/`.

---

## Migrations (existing database)

If your DB is already live, use **incremental** migrations only:

```bash
# .env must have MYSQL_* set
npm ci
npm run migrate:dev      # apply pending migrations from migrations/
npm run check:schema     # verify Drizzle schema matches DB
```

| Command | Description |
|---------|-------------|
| `npm run migrate:dev` | Run pending SQL migrations |
| `npm run check:schema` | Compare DB vs `shared/schema.ts` |
| `npm run generate:migration <name>` | Create new migration file |
| `npm run db:push` | Drizzle push (dev only — prefer SQL migrations for prod) |

Track history:

```sql
SELECT migration_name, executed_at, status
FROM schema_migrations
ORDER BY executed_at DESC
LIMIT 20;
```

---

## Verify your existing database

```sql
-- Table count
SELECT COUNT(*) AS tables
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';

-- List all tables
SHOW TABLES;

-- Check required seeds
SELECT * FROM subscription_types;
SELECT * FROM roles ORDER BY id;

-- Sample core tables
SHOW CREATE TABLE users\G
SHOW CREATE TABLE sdlc_projects\G
SHOW CREATE TABLE workflow_artifacts\G
```

Export schema only (for client handoff / backup):

```bash
mysqldump -h HOST -u USER -p --no-data --routines --triggers DATABASE > schema-only.sql
```

Compare your table list to `shared/schema.ts`, `shared/qe-schema.ts`, and `docs/database/TABLES_MANIFEST.json`.

---

## Full DDL for client handoff

Give clients **one** of:

1. **`migrations/auto-generated/Provision_7_04_2026.sql`** — complete CREATE TABLE + example seeds  
2. **`migrations/applied/qa-to-uat-schema-migration.sql`** — idempotent baseline for empty DB  
3. **`mysqldump --no-data`** from your working environment (sanitized)

Plus:

- `docs/database/DATABASE_REFERENCE.md` (this file)  
- `migrations/manual/SEED_DATA.sql`  
- `docs/guides/MIGRATION_GUIDE.md`

---

## Engine & conventions

- **Engine:** MySQL 8 / Aurora MySQL 8.0  
- **Charset:** `utf8mb4` recommended  
- **Primary keys:** Mostly `CHAR(36)` UUIDs; `roles.id` and `subscription_types.id` may be `INT` auto-increment  
- **Timestamps:** `created_at`, `updated_at` with `DEFAULT CURRENT_TIMESTAMP`  
- **Soft delete:** `users.is_deleted`, `users.deleted_at`  
- **JSON columns:** Used heavily in workflow artifacts, modernization, AI payloads  

---

## Support checklist for client DB teams

- [ ] `MYSQL_*` connects with SSL from app network  
- [ ] `subscription_types` has at least one active row  
- [ ] `roles` has default role rows  
- [ ] `schema_migrations` shows successful recent migrations  
- [ ] `npm run check:schema` passes against this codebase version  
- [ ] Cognito users can log in and appear in `users`  
- [ ] Optional: QE tables present if QE module is licensed  

---

*DevX 2.0 database reference — schema and migrations in repository. Regenerate table manifest: `node scripts/generate-database-reference.js`*

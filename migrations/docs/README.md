# Database Schema Migration Scripts

This directory contains SQL scripts for migrating database schema between environments.

## Migration Scripts

### 1. QA to UAT Migration (Complete Schema)
**File:** `qa-to-uat-schema-migration.sql`

Migrates **COMPLETE** database schema from QA environment to UAT environment. Schema only - NO DATA migration.

**Usage:**
```bash
# Direct migration (recommended - includes all table definitions)
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/qa-to-uat-schema-migration.sql
```

**Alternative: Extract from QA first, then apply**
```bash
# Step 1: Extract schema from QA
# On Linux/Mac:
./migrations/extract-qa-schema.sh

# On Windows:
.\migrations\extract-qa-schema.ps1

# Step 2: Apply extracted schema to UAT
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < qa-schema-extract.sql
```

**What it does:**
- Creates ALL tables if they don't exist (30+ tables including):
  - Core tables: `users`, `organizations`, `projects`
  - Golden repositories: `golden_repositories`, `golden_repo_organizations`
  - Azure DevOps: `ado_settings`, `artifact_organizations`, `conversational_ui_settings`
  - Workflow: `workflow_settings`, `workflow_artifacts`, `workflow_subtasks`
  - SDLC: `sdlc_projects`, `sdlc_phases`, `sdlc_epics`, `sdlc_features`, `sdlc_backlog_items`, etc.
  - Development: `development_repositories`, `development_branches`, `sdlc_code`, `sdlc_commits`, `sdlc_previews`
  - Design: `sdlc_design_assets`, `sdlc_figma_links`, `sdlc_design_reviews`, `ado_design_sync`
  - Documentation: `wiki_pages`, `personas`, `sdlc_documents`
- Adds missing columns to existing tables
- Creates all indexes and foreign key constraints
- Updates existing data where needed (e.g., wiki_pages phase mapping)
- **Idempotent** - safe to run multiple times

### 2. UAT to PROD Migration
**File:** `uat-to-prod-schema-migration.sql`

Migrates schema changes from UAT environment to PROD environment.

**Usage:**
```bash
mysql -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb < migrations/uat-to-prod-schema-migration.sql
```

**What it does:**
- Same schema changes as QA to UAT migration
- Applies all schema updates to production database

## Important Notes

### Before Running Migrations

1. **Backup the target database** - Always create a backup before running migrations
   ```bash
   mysqldump -h <host> -u devxadmin -p <database> > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Review the script** - Read through the migration script to understand what changes will be made

3. **Test in non-production** - Test the migration in a development/staging environment first

4. **Schedule maintenance window** - For PROD migrations, schedule during a maintenance window

5. **Notify stakeholders** - Inform team members before running PROD migrations

### For PROD Migrations Specifically

- ⚠️ **Schedule during maintenance window**
- ⚠️ **Notify all stakeholders**
- ⚠️ **Have rollback plan ready**
- ⚠️ **Monitor application after migration**

## Database Connection Details

### QA Environment
- **Host:** `qadevxmysqlserver.mysql.database.azure.com`
- **Database:** `qadevxdb`
- **User:** `devxadmin`
- **Port:** `3306`

### UAT Environment
- **Host:** `uatdevxmysqlserver.mysql.database.azure.com`
- **Database:** `uatdevxdb`
- **User:** `devxadmin`
- **Port:** `3306`

### PROD Environment
- **Host:** `devxserver.mysql.database.azure.com`
- **Database:** `devxdb`
- **User:** `devxadmin`
- **Port:** `3306`

## Migration Features

### Idempotent Operations
All migration scripts are designed to be **idempotent**, meaning they can be run multiple times safely. The scripts check if tables/columns exist before creating/adding them.

### Helper Procedures
The scripts use stored procedures to:
- `AddColumnIfNotExists` - Safely adds columns only if they don't exist
- `CreateTableIfNotExists` - Safely creates tables only if they don't exist

### Verification
After migration, the scripts run verification queries to:
- List all tables in the database
- Show table structures
- Verify column existence and definitions

## Troubleshooting

### Connection Issues
If you encounter connection issues:
1. Verify firewall rules allow your IP address
2. Check SSL certificate settings
3. Verify credentials are correct

### Migration Errors
If migration fails:
1. Check error messages carefully
2. Review which step failed
3. Restore from backup if needed
4. Fix the issue and re-run the migration

### Rollback
To rollback a migration:
1. Restore from the backup created before migration
2. Or manually reverse the changes made by the migration script

## Example Migration Workflow

### QA to UAT (Complete Schema Migration)
```bash
# 1. Backup UAT database (CRITICAL!)
mysqldump -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb > uat_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Run complete schema migration
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/qa-to-uat-schema-migration.sql

# 3. Verify migration - check all tables exist
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb -e "SHOW TABLES;"

# 4. Verify table count (should match QA)
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb -e "SELECT COUNT(*) as table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'uatdevxdb' AND TABLE_TYPE = 'BASE TABLE';"
```

### UAT to PROD
```bash
# 1. Backup PROD database (CRITICAL!)
mysqldump -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb > prod_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Schedule maintenance window
# 3. Notify stakeholders
# 4. Run migration
mysql -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb < migrations/uat-to-prod-schema-migration.sql

# 5. Verify migration
mysql -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb -e "SHOW TABLES;"

# 6. Test application
# 7. Monitor for issues
```

## Support

For issues or questions about migrations, contact the DevOps team or refer to the main project documentation.


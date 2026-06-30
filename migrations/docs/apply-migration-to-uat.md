# Apply Migration to UAT Database

The migration SQL has been generated and reviewed. Now apply it to UAT.

## Option 1: Azure Cloud Shell (Recommended)

1. **Open Azure Cloud Shell**: https://shell.azure.com

2. **Upload the migration file**:
   ```bash
   mkdir migration
   cd migration
   ```
   - Click **Upload/Download files** icon
   - Upload: `migrations/qa-to-uat-migration.sql`

3. **Backup UAT first** (IMPORTANT!):
   ```bash
   mysqldump -h uatdevxmysqlserver.mysql.database.azure.com \
             -u devxadmin \
             -p \
             uatdevxdb > uat-backup-$(date +%Y%m%d_%H%M%S).sql
   ```

4. **Apply migration**:
   ```bash
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb < qa-to-uat-migration.sql
   ```

5. **Verify**:
   ```bash
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb -e "SHOW TABLES;"
   ```

---

## Option 2: Use Node.js Script

Create a simple script to apply the migration:

```bash
npx tsx migrations/run-migration-nodejs.ts
```

Or modify the existing script to apply directly.

---

## Option 3: Azure Portal Query Editor

1. Go to Azure Portal → MySQL server → Query editor
2. Connect to `uatdevxdb`
3. Copy/paste the SQL from `migrations/qa-to-uat-migration.sql`
4. Click **Run**

---

## What Will Be Applied

✅ **2 New Tables:**
- `workflow_artifacts`
- `workflow_subtasks`

✅ **5 New Columns:**
- `sdlc_projects.project_id`
- `sdlc_projects.ado_project_url`
- `sdlc_projects.linked_golden_repo_org`
- `sdlc_projects.linked_golden_repo_project`
- `wiki_pages.phase`

---

## After Migration

Verify the migration was successful:

```sql
-- Check tables exist
SHOW TABLES LIKE 'workflow_%';

-- Check columns were added
DESCRIBE sdlc_projects;
DESCRIBE wiki_pages;
```


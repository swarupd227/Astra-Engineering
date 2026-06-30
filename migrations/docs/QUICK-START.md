# Quick Start: Run Migration (Cannot Execute Directly)

Since you **cannot execute directly** from your machine, here are the **easiest options**:

---

## ✅ Option 1: Azure Cloud Shell (Easiest - 5 minutes)

### Steps:

1. **Open Azure Cloud Shell**
   - Go to: https://shell.azure.com
   - Or: Azure Portal → Click `>_` icon (top right)

2. **Upload the migration file**
   ```bash
   mkdir migration
   cd migration
   ```
   - Click **Upload/Download files** button (toolbar)
   - Upload: `migrations/qa-to-uat-schema-migration.sql`

3. **Run migration**
   ```bash
   # Backup first
   mysqldump -h uatdevxmysqlserver.mysql.database.azure.com \
             -u devxadmin \
             -p \
             uatdevxdb > backup.sql
   
   # Run migration
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb < qa-to-uat-schema-migration.sql
   ```
   - Enter password when prompted

4. **Done!** ✅

---

## ✅ Option 2: Use Existing Node.js Script

You already have a migration script! Just run it:

```bash
# From project root
npx tsx scripts/migrate-schema-qa-to-uat.ts
```

This script will:
- Connect to QA and UAT databases
- Compare schemas
- Generate and apply migration SQL
- Save migration file for review

**Note**: Make sure you have Node.js and dependencies installed.

---

## ✅ Option 3: Azure Portal Query Editor

1. Go to Azure Portal
2. Navigate to: **MySQL servers** → `uatdevxmysqlserver`
3. Click **Query editor** (left menu)
4. Connect with:
   - Database: `uatdevxdb`
   - Username: `devxadmin`
   - Password: (your password)
5. Copy the SQL from `migrations/qa-to-uat-schema-migration.sql`
6. Paste and click **Run**

⚠️ **Note**: If the script is too large, split it or use Option 1.

---

## Which Option to Choose?

- **No MySQL client?** → Use **Option 1** (Azure Cloud Shell)
- **Have Node.js?** → Use **Option 2** (Existing script)
- **Prefer GUI?** → Use **Option 3** (Azure Portal)

---

## Need More Details?

- See `migrations/HOW-TO-RUN.md` for detailed instructions
- See `migrations/run-migration-azure-portal.md` for all Azure methods
- See `migrations/README.md` for complete documentation


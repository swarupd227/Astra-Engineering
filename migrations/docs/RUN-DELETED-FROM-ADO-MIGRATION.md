# How to Run the `deleted_from_ado` Column Migration

This guide explains how to run the migration files that add the `deleted_from_ado` column to the `sdlc_projects` table.

## Migration Files

- **QA**: `add-deleted-from-ado-column-qa.sql`
- **UAT**: `add-deleted-from-ado-column-uat.sql`
- **PROD**: `add-deleted-from-ado-column-prod.sql`

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
- **Host:** `devxserver.mysql.database.azure.com` (or your PROD MySQL server hostname)
- **Database:** `devxdb`
- **User:** `devxadmin`
- **Port:** `3306`

---

## Method 1: MySQL Command Line (If You Have MySQL Client)

### For QA Database

**On Windows (PowerShell):**
```powershell
cd "C:\Users\omjha\OneDrive - Nous Infosystems\Desktop\DevX_2.0\GitLab\Lastest\devx"
mysql -h qadevxmysqlserver.mysql.database.azure.com -u devxadmin -p qadevxdb < migrations\add-deleted-from-ado-column-qa.sql
```

**On Windows (Command Prompt):**
```cmd
cd "C:\Users\omjha\OneDrive - Nous Infosystems\Desktop\DevX_2.0\GitLab\Lastest\devx"
mysql -h qadevxmysqlserver.mysql.database.azure.com -u devxadmin -p qadevxdb < migrations\add-deleted-from-ado-column-qa.sql
```

**On Linux/Mac:**
```bash
cd /path/to/devx
mysql -h qadevxmysqlserver.mysql.database.azure.com -u devxadmin -p qadevxdb < migrations/add-deleted-from-ado-column-qa.sql
```

### For UAT Database

**On Windows (PowerShell):**
```powershell
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations\add-deleted-from-ado-column-uat.sql
```

**On Linux/Mac:**
```bash
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/add-deleted-from-ado-column-uat.sql
```

### For PROD Database

⚠️ **IMPORTANT**: Always backup PROD before running migrations!

**On Windows (PowerShell):**
```powershell
# Step 1: Backup PROD database first!
mysqldump -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb > prod-backup-$(Get-Date -Format "yyyyMMdd_HHmmss").sql

# Step 2: Run migration
mysql -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb < migrations\add-deleted-from-ado-column-prod.sql
```

**On Linux/Mac:**
```bash
# Step 1: Backup PROD database first!
mysqldump -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb > prod-backup-$(date +%Y%m%d_%H%M%S).sql

# Step 2: Run migration
mysql -h devxserver.mysql.database.azure.com -u devxadmin -p devxdb < migrations/add-deleted-from-ado-column-prod.sql
```

---

## Method 2: Azure Cloud Shell (Recommended if No MySQL Client)

1. **Open Azure Cloud Shell**
   - Go to: https://shell.azure.com
   - Or: Azure Portal → Click `>_` icon (top right) → Choose **Bash**

2. **Upload the migration file**
   ```bash
   mkdir migration
   cd migration
   ```
   - Click **Upload/Download files** button (toolbar)
   - Upload the appropriate migration file (e.g., `add-deleted-from-ado-column-qa.sql`)

3. **Run migration**
   ```bash
   # For QA
   mysql -h qadevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         qadevxdb < add-deleted-from-ado-column-qa.sql
   
   # For UAT
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb < add-deleted-from-ado-column-uat.sql
   
   # For PROD (backup first!)
   mysqldump -h devxserver.mysql.database.azure.com \
             -u devxadmin \
             -p \
             devxdb > prod-backup-$(date +%Y%m%d_%H%M%S).sql
   
   mysql -h devxserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         devxdb < add-deleted-from-ado-column-prod.sql
   ```
   - Enter password when prompted

---

## Method 3: Azure Portal Query Editor (GUI Method)

1. Go to **Azure Portal**
2. Navigate to your MySQL server:
   - QA: `qadevxmysqlserver`
   - UAT: `uatdevxmysqlserver`
   - PROD: `devxserver` (or your PROD server name)
3. Click **Query editor** (left menu)
4. Connect with:
   - Database: `qadevxdb` / `uatdevxdb` / `devxdb`
   - Username: `devxadmin`
   - Password: (your password)
5. Open the migration file and copy its contents
6. Paste into the query editor
7. Click **Run** (⚡ button)

⚠️ **Note**: Query editor may have size limits. If the file is too large, use Method 1 or 2.

---

## Method 4: MySQL Workbench (GUI Method)

1. **Open MySQL Workbench**
2. **Create a new connection:**
   - Connection Name: `QA DevX` / `UAT DevX` / `PROD DevX`
   - Hostname: 
     - QA: `qadevxmysqlserver.mysql.database.azure.com`
     - UAT: `uatdevxmysqlserver.mysql.database.azure.com`
     - PROD: `devxserver.mysql.database.azure.com`
   - Username: `devxadmin`
   - Password: (your password)
   - Default Schema: `qadevxdb` / `uatdevxdb` / `devxdb`
3. **Connect**
4. **File → Open SQL Script**
   - Select: `migrations/add-deleted-from-ado-column-qa.sql` (or uat/prod)
5. **Execute** (⚡ button or Ctrl+Shift+Enter)

---

## Verification

After running the migration, verify the column was added:

```sql
-- Check if column exists
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'qadevxdb'  -- or 'uatdevxdb' or 'devxdb'
AND TABLE_NAME = 'sdlc_projects' 
AND COLUMN_NAME = 'deleted_from_ado';
```

**Expected Output:**
```
COLUMN_NAME        DATA_TYPE  IS_NULLABLE  COLUMN_DEFAULT
deleted_from_ado   tinyint    NO           0
```

Or using command line:
```bash
mysql -h <host> -u devxadmin -p <database> -e "DESCRIBE sdlc_projects;"
```

Look for `deleted_from_ado` in the output.

---

## What the Migration Does

✅ Adds `deleted_from_ado` column to `sdlc_projects` table  
✅ Column type: `TINYINT(1)` (boolean)  
✅ Default value: `0` (false)  
✅ NOT NULL constraint  
✅ Positioned after `status` column  
✅ **Idempotent** - safe to run multiple times (checks if column exists first)

---

## Troubleshooting

### "Command not found: mysql"
- Install MySQL client: https://dev.mysql.com/downloads/mysql/
- Or use MySQL Workbench
- Or use Azure Cloud Shell (Method 2)

### "Access denied"
- Check username/password
- Verify your IP is whitelisted in Azure MySQL firewall rules
- Check SSL settings if required

### "Can't connect to MySQL server"
- Verify firewall rules allow your IP
- Check hostname is correct
- Verify network connectivity

### Column already exists
- This is normal if you run the migration multiple times
- The script is idempotent and will skip if column exists
- No action needed

---

## Important Notes

1. **Backup First**: Always backup PROD database before running migrations
2. **Test in QA/UAT First**: Run in QA, then UAT, then PROD
3. **Idempotent**: Safe to run multiple times - won't cause errors if column already exists
4. **No Data Loss**: This migration only adds a column - no data is modified or deleted

---

## Quick Reference

| Environment | Host | Database | Migration File |
|------------|------|----------|----------------|
| QA | `qadevxmysqlserver.mysql.database.azure.com` | `qadevxdb` | `add-deleted-from-ado-column-qa.sql` |
| UAT | `uatdevxmysqlserver.mysql.database.azure.com` | `uatdevxdb` | `add-deleted-from-ado-column-uat.sql` |
| PROD | `devxserver.mysql.database.azure.com` | `devxdb` | `add-deleted-from-ado-column-prod.sql` |

---

## Need Help?

- See `migrations/HOW-TO-RUN.md` for detailed migration instructions
- See `migrations/README.md` for complete documentation
- Check Azure Portal → MySQL server → Query editor for GUI access


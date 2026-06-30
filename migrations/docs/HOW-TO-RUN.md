# How to Run QA to UAT Schema Migration

## ⚠️ Cannot Execute Directly?

If you **cannot execute the migration directly** from your machine (no MySQL client, network restrictions, etc.), see **Alternative Methods** below.

---

## Quick Start (If You Have Direct Access)

### Step 1: Backup UAT Database First! ⚠️

**On Windows (PowerShell):**
```powershell
mysqldump -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb > uat-backup-$(Get-Date -Format "yyyyMMdd_HHmmss").sql
```

**On Linux/Mac:**
```bash
mysqldump -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb > uat-backup-$(date +%Y%m%d_%H%M%S).sql
```

### Step 2: Run the Migration Script

**On Windows (PowerShell):**
```powershell
# Navigate to project root directory
cd C:\Users\omjha\OneDrive` -` Nous` Infosystems\Desktop\DevX_2.0\GitLab\Lastest\devx

# Run migration
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations\qa-to-uat-schema-migration.sql
```

**On Windows (Command Prompt):**
```cmd
cd "C:\Users\omjha\OneDrive - Nous Infosystems\Desktop\DevX_2.0\GitLab\Lastest\devx"
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations\qa-to-uat-schema-migration.sql
```

**On Linux/Mac:**
```bash
cd /path/to/devx
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/qa-to-uat-schema-migration.sql
```

### Step 3: Verify Migration

**Check all tables exist:**
```bash
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb -e "SHOW TABLES;"
```

**Count tables (should match QA):**
```bash
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb -e "SELECT COUNT(*) as table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'uatdevxdb' AND TABLE_TYPE = 'BASE TABLE';"
```

---

## Alternative Method: Extract Schema from QA First

If you want to extract the exact schema from QA first:

### Step 1: Extract Schema from QA

**On Windows (PowerShell):**
```powershell
.\migrations\extract-qa-schema.ps1
```

**On Linux/Mac:**
```bash
chmod +x migrations/extract-qa-schema.sh
./migrations/extract-qa-schema.sh
```

**Or manually:**
```bash
mysqldump -h qadevxmysqlserver.mysql.database.azure.com -u devxadmin -p --no-data --routines --triggers --single-transaction qadevxdb > qa-schema-extract.sql
```

### Step 2: Review Extracted Schema
```bash
# Review the file
cat qa-schema-extract.sql
# or on Windows
type qa-schema-extract.sql
```

### Step 3: Apply to UAT
```bash
mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < qa-schema-extract.sql
```

---

## Prerequisites

1. **MySQL Client Installed**
   - Windows: Download from [MySQL Downloads](https://dev.mysql.com/downloads/mysql/)
   - Or use MySQL Workbench
   - Or use WSL (Windows Subsystem for Linux)

2. **Network Access**
   - Ensure your IP is whitelisted in Azure MySQL firewall rules
   - Or use Azure VPN/Private Endpoint

3. **Credentials**
   - Username: `devxadmin`
   - Password: (will be prompted)
   - Database: `uatdevxdb`

---

## Troubleshooting

### "Command not found: mysql"
- Install MySQL client or add to PATH
- Or use MySQL Workbench GUI
- Or use WSL on Windows

### "Access denied"
- Check username/password
- Verify IP is whitelisted in Azure MySQL firewall

### "Can't connect to MySQL server"
- Check firewall rules
- Verify hostname is correct
- Check network connectivity

### Using MySQL Workbench (GUI Alternative)

1. Open MySQL Workbench
2. Create new connection:
   - Host: `uatdevxmysqlserver.mysql.database.azure.com`
   - Username: `devxadmin`
   - Password: (your password)
   - Default Schema: `uatdevxdb`
3. Connect
4. File → Open SQL Script → Select `migrations/qa-to-uat-schema-migration.sql`
5. Execute (⚡ button)

---

## What the Script Does

✅ Creates all 30+ tables if they don't exist  
✅ Adds missing columns to existing tables  
✅ Creates indexes and foreign keys  
✅ Updates data where needed (e.g., wiki_pages phase mapping)  
✅ **Idempotent** - safe to run multiple times  
✅ **No data loss** - only schema changes  

---

## Expected Output

When successful, you'll see:
```
result
----------------------------------------
Schema migration completed. Verifying schema...
Created table: users
Created table: organizations
...
Column already exists: sdlc_epics.source
...
Complete schema migration from QA to UAT completed successfully!
```

---

---

## Alternative Methods (If You Cannot Execute Directly)

### Method 1: Azure Cloud Shell ⭐ (Easiest - Recommended)

**Best if**: You don't have MySQL client installed or have network restrictions

1. **Open Azure Cloud Shell**
   - Go to https://shell.azure.com
   - Or click Cloud Shell icon in Azure Portal (top right: `>_`)
   - Choose **Bash**

2. **Upload Migration File**
   ```bash
   # Create directory
   mkdir migration
   cd migration
   ```
   - Click **Upload/Download files** icon (toolbar)
   - Upload `qa-to-uat-schema-migration.sql`

3. **Run Migration**
   ```bash
   # Backup first
   mysqldump -h uatdevxmysqlserver.mysql.database.azure.com \
             -u devxadmin \
             -p \
             uatdevxdb > uat-backup-$(date +%Y%m%d_%H%M%S).sql
   
   # Run migration
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb < qa-to-uat-schema-migration.sql
   ```

4. **Verify**
   ```bash
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb -e "SHOW TABLES;"
   ```

**See**: `migrations/run-migration-azure-cloud-shell.sh` for automated script

---

### Method 2: Azure Portal Query Editor

**Best if**: You prefer GUI and script is small enough

1. Go to Azure Portal → Your MySQL server (`uatdevxmysqlserver`)
2. Click **Query editor** (left menu)
3. Connect with:
   - Database: `uatdevxdb`
   - Username: `devxadmin`
   - Password: (your password)
4. Copy/paste the migration SQL
5. Click **Run**

⚠️ **Note**: Query editor may have size limits. If it fails, use Method 1.

---

### Method 3: Node.js Script

**Best if**: You have Node.js installed and can run TypeScript

1. **Install dependencies** (if not already):
   ```bash
   npm install mysql2
   npm install -D tsx  # or ts-node
   ```

2. **Run the script**:
   ```bash
   npx tsx migrations/run-migration-nodejs.ts
   # or
   ts-node migrations/run-migration-nodejs.ts
   ```

3. Enter password when prompted

**See**: `migrations/run-migration-nodejs.ts` for the script

---

### Method 4: Use Existing Migration Scripts

You already have migration scripts in the codebase! Check:
- `scripts/migrate-schema-qa-to-uat.ts` - Automated schema migration
- `scripts/apply-workflow-artifacts-migration.ts` - Example of running migrations via Node.js

**Run existing script**:
```bash
npx tsx scripts/migrate-schema-qa-to-uat.ts
```

---

### Method 5: CI/CD Pipeline

**Best if**: You want automated, repeatable migrations

Create a GitHub Actions workflow or Azure DevOps pipeline. See `migrations/run-migration-azure-portal.md` for examples.

---

### Method 6: Jump Server / VM

**Best if**: You have a VM in Azure with network access

1. SSH into your VM
2. Install MySQL client: `sudo apt-get install mysql-client`
3. Transfer migration file: `scp migrations/qa-to-uat-schema-migration.sql user@vm:/tmp/`
4. Run migration from VM

---

## Detailed Guides

- **Azure Portal Methods**: See `migrations/run-migration-azure-portal.md`
- **All Methods**: See `migrations/README.md`

---

## Need Help?

- Check `migrations/README.md` for detailed documentation
- Review error messages carefully
- Restore from backup if needed: `mysql -h ... -u ... -p uatdevxdb < uat-backup-YYYYMMDD_HHMMSS.sql`
- Try **Azure Cloud Shell** (Method 1) - it's the easiest if you can't execute directly


# Run Migration via Azure Portal

If you cannot execute the migration directly from your machine, you can use Azure Portal's built-in tools.

## Method 1: Azure Cloud Shell (Recommended)

### Steps:

1. **Open Azure Cloud Shell**
   - Go to https://portal.azure.com
   - Click the Cloud Shell icon (top right: `>_`)
   - Choose **Bash** or **PowerShell**

2. **Upload Migration Files**
   ```bash
   # In Cloud Shell, create a directory
   mkdir migration
   cd migration
   ```
   
   - Click the **Upload/Download files** icon (toolbar)
   - Upload `qa-to-uat-schema-migration.sql`

3. **Run Migration**
   ```bash
   # Install MySQL client if needed (usually pre-installed)
   # mysql --version
   
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

---

## Method 2: Azure Database Query Editor

### Steps:

1. **Open Azure Portal**
   - Navigate to your MySQL server: `uatdevxmysqlserver`
   - Go to **Query editor** (left menu)

2. **Connect to Database**
   - Database: `uatdevxdb`
   - Username: `devxadmin`
   - Password: (enter your password)

3. **Run Migration Script**
   - Copy the entire content of `qa-to-uat-schema-migration.sql`
   - Paste into the query editor
   - Click **Run**

   ⚠️ **Note**: Query editor may have limitations on large scripts. If it fails:
   - Split the script into smaller chunks
   - Or use Method 1 (Cloud Shell)

---

## Method 3: Azure Database Migration Service

For automated migrations:

1. **Create Migration Service**
   - Azure Portal → Create Resource → Search "Azure Database Migration Service"
   - Create new service

2. **Create Migration Project**
   - Source: QA MySQL server
   - Target: UAT MySQL server
   - Migration type: Schema only

3. **Run Migration**
   - Follow the wizard to complete migration

---

## Method 4: Use a Jump Server / VM

If you have a VM in Azure with network access:

1. **SSH into VM**
   ```bash
   ssh user@your-vm.azure.com
   ```

2. **Install MySQL Client** (if needed)
   ```bash
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install mysql-client
   
   # CentOS/RHEL
   sudo yum install mysql
   ```

3. **Transfer Migration File**
   ```bash
   # From your local machine
   scp migrations/qa-to-uat-schema-migration.sql user@your-vm:/tmp/
   ```

4. **Run Migration**
   ```bash
   mysql -h uatdevxmysqlserver.mysql.database.azure.com \
         -u devxadmin \
         -p \
         uatdevxdb < /tmp/qa-to-uat-schema-migration.sql
   ```

---

## Method 5: CI/CD Pipeline

If you have a CI/CD pipeline (GitHub Actions, Azure DevOps, etc.):

### GitHub Actions Example:

```yaml
name: Migrate Schema QA to UAT

on:
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup MySQL Client
        run: sudo apt-get install -y mysql-client
      
      - name: Run Migration
        env:
          MYSQL_PASSWORD: ${{ secrets.UAT_MYSQL_PASSWORD }}
        run: |
          mysql -h uatdevxmysqlserver.mysql.database.azure.com \
                -u devxadmin \
                -p$MYSQL_PASSWORD \
                uatdevxdb < migrations/qa-to-uat-schema-migration.sql
```

---

## Recommended Approach

**For one-time migration**: Use **Azure Cloud Shell** (Method 1)
- No local setup needed
- Pre-installed tools
- Direct access to Azure resources

**For automated/repeatable migrations**: Use **CI/CD Pipeline** (Method 5)
- Version controlled
- Automated
- Auditable

---

## Troubleshooting

### "Access Denied" in Cloud Shell
- Verify firewall rules allow Azure services
- Check username/password

### "Connection Timeout"
- Verify network connectivity
- Check firewall rules
- Try from different network

### "File Too Large" in Query Editor
- Use Cloud Shell instead
- Or split script into smaller files


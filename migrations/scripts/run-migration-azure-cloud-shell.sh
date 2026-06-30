#!/bin/bash
# ============================================
# Run Migration via Azure Cloud Shell
# ============================================
# Description: This script can be run in Azure Cloud Shell
#              Azure Cloud Shell has MySQL client pre-installed
#
# Steps:
#   1. Open Azure Cloud Shell: https://shell.azure.com
#   2. Upload this script and the migration SQL file
#   3. Run: bash run-migration-azure-cloud-shell.sh
# ============================================

UAT_HOST="uatdevxmysqlserver.mysql.database.azure.com"
UAT_DB="uatdevxdb"
UAT_USER="devxadmin"

echo "============================================"
echo "QA to UAT Schema Migration"
echo "Running in Azure Cloud Shell"
echo "============================================"

# Check if migration file exists
if [ ! -f "qa-to-uat-schema-migration.sql" ]; then
    echo "Error: qa-to-uat-schema-migration.sql not found!"
    echo "Please upload the migration file to Azure Cloud Shell first."
    exit 1
fi

# Prompt for password
read -sp "Enter MySQL password for $UAT_USER: " MYSQL_PASSWORD
echo ""

# Backup first
echo "Step 1: Creating backup..."
mysqldump -h "$UAT_HOST" \
  -u "$UAT_USER" \
  -p"$MYSQL_PASSWORD" \
  "$UAT_DB" > "uat-backup-$(date +%Y%m%d_%H%M%S).sql"

if [ $? -eq 0 ]; then
    echo "✓ Backup created successfully"
else
    echo "✗ Backup failed! Aborting migration."
    exit 1
fi

# Run migration
echo ""
echo "Step 2: Running migration..."
mysql -h "$UAT_HOST" \
  -u "$UAT_USER" \
  -p"$MYSQL_PASSWORD" \
  "$UAT_DB" < qa-to-uat-schema-migration.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Migration completed successfully!"
    echo ""
    echo "Step 3: Verifying migration..."
    mysql -h "$UAT_HOST" \
      -u "$UAT_USER" \
      -p"$MYSQL_PASSWORD" \
      "$UAT_DB" -e "SELECT COUNT(*) as table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '$UAT_DB' AND TABLE_TYPE = 'BASE TABLE';"
else
    echo ""
    echo "✗ Migration failed!"
    echo "You can restore from backup if needed."
    exit 1
fi


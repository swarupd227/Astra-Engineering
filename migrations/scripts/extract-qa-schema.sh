#!/bin/bash
# ============================================
# Extract Schema from QA Database
# ============================================
# Description: Extracts complete schema (no data) from QA database
#              This script should be run BEFORE applying the migration to UAT
#
# Usage:
#   ./migrations/extract-qa-schema.sh
#
# Output: qa-schema-extract.sql
# ============================================

QA_HOST="qadevxmysqlserver.mysql.database.azure.com"
QA_DB="qadevxdb"
QA_USER="devxadmin"
OUTPUT_FILE="qa-schema-extract.sql"

echo "============================================"
echo "Extracting schema from QA database..."
echo "Host: $QA_HOST"
echo "Database: $QA_DB"
echo "Output file: $OUTPUT_FILE"
echo "============================================"

# Extract schema only (no data)
mysqldump -h "$QA_HOST" \
  -u "$QA_USER" \
  -p \
  --no-data \
  --routines \
  --triggers \
  --single-transaction \
  --skip-add-drop-table \
  --skip-comments \
  "$QA_DB" > "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Schema extraction completed successfully!"
    echo "✓ Schema saved to: $OUTPUT_FILE"
    echo ""
    echo "Next steps:"
    echo "1. Review the extracted schema file: $OUTPUT_FILE"
    echo "2. Run the migration script on UAT:"
    echo "   mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/qa-to-uat-schema-migration.sql"
    echo ""
else
    echo ""
    echo "✗ Schema extraction failed!"
    echo "Please check your connection and credentials."
    echo ""
    exit 1
fi


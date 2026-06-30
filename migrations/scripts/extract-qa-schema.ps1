# ============================================
# Extract Schema from QA Database (PowerShell)
# ============================================
# Description: Extracts complete schema (no data) from QA database
#              This script should be run BEFORE applying the migration to UAT
#
# Usage:
#   .\migrations\extract-qa-schema.ps1
#
# Output: qa-schema-extract.sql
# ============================================

$QA_HOST = "qadevxmysqlserver.mysql.database.azure.com"
$QA_DB = "qadevxdb"
$QA_USER = "devxadmin"
$OUTPUT_FILE = "qa-schema-extract.sql"

Write-Host "============================================"
Write-Host "Extracting schema from QA database..."
Write-Host "Host: $QA_HOST"
Write-Host "Database: $QA_DB"
Write-Host "Output file: $OUTPUT_FILE"
Write-Host "============================================"

# Extract schema only (no data)
$password = Read-Host "Enter MySQL password for $QA_USER" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# Note: This requires mysqldump to be in PATH
# Alternative: Use full path to mysqldump.exe
mysqldump -h $QA_HOST `
  -u $QA_USER `
  -p$plainPassword `
  --no-data `
  --routines `
  --triggers `
  --single-transaction `
  --skip-add-drop-table `
  --skip-comments `
  $QA_DB | Out-File -FilePath $OUTPUT_FILE -Encoding utf8

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ Schema extraction completed successfully!" -ForegroundColor Green
    Write-Host "✓ Schema saved to: $OUTPUT_FILE" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "1. Review the extracted schema file: $OUTPUT_FILE"
    Write-Host "2. Run the migration script on UAT:"
    Write-Host "   mysql -h uatdevxmysqlserver.mysql.database.azure.com -u devxadmin -p uatdevxdb < migrations/qa-to-uat-schema-migration.sql"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "✗ Schema extraction failed!" -ForegroundColor Red
    Write-Host "Please check your connection and credentials." -ForegroundColor Red
    Write-Host ""
    exit 1
}


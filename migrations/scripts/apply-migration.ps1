# ============================================
# Apply Migration to UAT (PowerShell)
# ============================================
# Description: Applies the generated migration SQL to UAT database
# 
# Usage:
#   .\migrations\apply-migration.ps1
# ============================================

$UAT_HOST = "uatdevxmysqlserver.mysql.database.azure.com"
$UAT_DB = "uatdevxdb"
$UAT_USER = "devxadmin"
$MIGRATION_FILE = "migrations\qa-to-uat-migration.sql"

Write-Host "============================================"
Write-Host "Apply Migration to UAT Database"
Write-Host "============================================"
Write-Host ""

# Check if migration file exists
if (-not (Test-Path $MIGRATION_FILE)) {
    Write-Host "Error: Migration file not found: $MIGRATION_FILE" -ForegroundColor Red
    Write-Host "Please run the migration script first: npx tsx scripts/migrate-schema-qa-to-uat.ts" -ForegroundColor Yellow
    exit 1
}

Write-Host "Migration file found: $MIGRATION_FILE" -ForegroundColor Green
Write-Host ""

# Prompt for password
$password = Read-Host "Enter MySQL password for $UAT_USER" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

Write-Host ""
Write-Host "Step 1: Creating backup..." -ForegroundColor Cyan
$backupFile = "uat-backup-$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"

# Note: This requires mysqldump to be installed
# If not available, skip backup or use Azure Portal
try {
    mysqldump -h $UAT_HOST -u $UAT_USER -p$plainPassword $UAT_DB | Out-File -FilePath $backupFile -Encoding utf8
    Write-Host "✓ Backup created: $backupFile" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Could not create backup (mysqldump not found)" -ForegroundColor Yellow
    Write-Host "   Please create backup manually before proceeding" -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 0
    }
}

Write-Host ""
Write-Host "Step 2: Applying migration..." -ForegroundColor Cyan

# Apply migration
try {
    Get-Content $MIGRATION_FILE | mysql -h $UAT_HOST -u $UAT_USER -p$plainPassword $UAT_DB
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Migration applied successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Step 3: Verifying..." -ForegroundColor Cyan
        
        # Verify tables
        mysql -h $UAT_HOST -u $UAT_USER -p$plainPassword $UAT_DB -e "SHOW TABLES LIKE 'workflow_%';"
        
        Write-Host ""
        Write-Host "============================================"
        Write-Host "✓ Migration completed successfully!" -ForegroundColor Green
        Write-Host "============================================"
    } else {
        Write-Host ""
        Write-Host "✗ Migration failed!" -ForegroundColor Red
        Write-Host "Check error messages above" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "✗ Migration failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}


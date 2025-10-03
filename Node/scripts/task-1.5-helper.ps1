# Task 1.5 Helper Script - Verify Entra ID Configuration
# This script helps verify prerequisites and guides through user setup

param(
    [string]$EnvFile = "../.env"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Task 1.5: Entra ID User Setup Helper" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables
if (Test-Path $EnvFile) {
    Write-Host "Loading environment variables from $EnvFile" -ForegroundColor Yellow
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "env:$name" -Value $value
        }
    }
    Write-Host ""
} else {
    Write-Host "ERROR: .env file not found at: $EnvFile" -ForegroundColor Red
    exit 1
}

$SERVER = $env:SERVER_NAME
$DATABASE = $env:DATABASE_NAME
$TENANT_ID = $env:AZURE_TENANT_ID

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Server: $SERVER"
Write-Host "  Database: $DATABASE"
Write-Host "  Tenant ID: $TENANT_ID"
Write-Host ""

# Step 1: Check if Azure CLI is installed
Write-Host "Step 1: Checking Azure CLI..." -ForegroundColor Cyan
try {
    $azVersion = az version --output tsv 2>$null
    if ($azVersion) {
        Write-Host "  SUCCESS: Azure CLI is installed" -ForegroundColor Green
    }
} catch {
    Write-Host "  WARNING: Azure CLI not found" -ForegroundColor Yellow
    Write-Host "  Install from: https://aka.ms/azure-cli" -ForegroundColor Gray
    Write-Host ""
}

# Step 2: Check Azure CLI login status
Write-Host "Step 2: Checking Azure CLI authentication..." -ForegroundColor Cyan
try {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if ($account) {
        Write-Host "  SUCCESS: Logged in to Azure" -ForegroundColor Green
        Write-Host "    Account: $($account.user.name)" -ForegroundColor Gray
        Write-Host "    Subscription: $($account.name)" -ForegroundColor Gray
        Write-Host ""
    }
} catch {
    Write-Host "  WARNING: Not logged in to Azure CLI" -ForegroundColor Yellow
    Write-Host "  Run: az login" -ForegroundColor Gray
    Write-Host ""
}

# Step 3: Check SQL Server Entra ID admin
Write-Host "Step 3: Checking SQL Server Entra ID admin configuration..." -ForegroundColor Cyan
if ($SERVER -and $SERVER -match '^(.+)\.database\.windows\.net$') {
    $serverName = $matches[1]
    Write-Host "  Server name: $serverName" -ForegroundColor Gray
    
    Write-Host "  NOTE: This requires Azure CLI and proper permissions" -ForegroundColor Yellow
    Write-Host "  Command to check:" -ForegroundColor Gray
    Write-Host "    az sql server ad-admin list --resource-group <rg-name> --server $serverName" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "  WARNING: Could not parse server name from: $SERVER" -ForegroundColor Yellow
    Write-Host ""
}

# Step 4: Provide SQL connection guidance
Write-Host "Step 4: Connect to Azure SQL Database" -ForegroundColor Cyan
Write-Host "  You need to connect as an Entra ID administrator to create users" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Option A - Azure Data Studio (Recommended):" -ForegroundColor Green
Write-Host "    1. Open Azure Data Studio" -ForegroundColor Gray
Write-Host "    2. New Connection" -ForegroundColor Gray
Write-Host "    3. Server: $SERVER" -ForegroundColor Gray
Write-Host "    4. Authentication: Azure Active Directory - Universal with MFA" -ForegroundColor Gray
Write-Host "    5. Database: $DATABASE" -ForegroundColor Gray
Write-Host "    6. Connect" -ForegroundColor Gray
Write-Host ""
Write-Host "  Option B - sqlcmd:" -ForegroundColor Green
Write-Host "    sqlcmd -S $SERVER -d $DATABASE -G -U <your-admin-email@domain.com>" -ForegroundColor Gray
Write-Host ""
Write-Host "  Option C - SSMS (SQL Server Management Studio):" -ForegroundColor Green
Write-Host "    1. Connect to Database Engine" -ForegroundColor Gray
Write-Host "    2. Server: $SERVER" -ForegroundColor Gray
Write-Host "    3. Authentication: Azure Active Directory - Universal with MFA" -ForegroundColor Gray
Write-Host "    4. Database: $DATABASE" -ForegroundColor Gray
Write-Host ""

# Step 5: Provide user creation guidance
Write-Host "Step 5: Create Entra ID Users in Database" -ForegroundColor Cyan
Write-Host "  Once connected, run the SQL setup script:" -ForegroundColor Yellow
Write-Host "    Location: ./sql/setup-entra-users.sql" -ForegroundColor Gray
Write-Host ""
Write-Host "  The script will:" -ForegroundColor Gray
Write-Host "    - Create Entra ID users (you need to uncomment and modify)" -ForegroundColor Gray
Write-Host "    - Create Entra ID security groups (optional)" -ForegroundColor Gray
Write-Host "    - Create custom database roles for RLS" -ForegroundColor Gray
Write-Host "    - Grant appropriate permissions" -ForegroundColor Gray
Write-Host "    - Verify the setup" -ForegroundColor Gray
Write-Host ""

# Step 6: Provide testing guidance
Write-Host "Step 6: Testing User Connectivity" -ForegroundColor Cyan
Write-Host "  After creating users, test that they can connect:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Test Query (run as the user):" -ForegroundColor Green
Write-Host "    SELECT USER_NAME() AS CurrentUser;" -ForegroundColor Gray
Write-Host ""
Write-Host "  Expected Result:" -ForegroundColor Green
Write-Host "    CurrentUser should show: user@yourdomain.com" -ForegroundColor Gray
Write-Host ""
Write-Host "  Check Permissions:" -ForegroundColor Green
Write-Host "    SELECT * FROM fn_my_permissions(NULL, 'DATABASE');" -ForegroundColor Gray
Write-Host ""

# Step 7: Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary - Task 1.5 Checklist" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Prerequisites:" -ForegroundColor Yellow
Write-Host "  [ ] Azure SQL Server has Entra ID admin configured" -ForegroundColor Gray
Write-Host "  [ ] You have admin access to the database" -ForegroundColor Gray
Write-Host "  [ ] Users exist in your Entra ID tenant" -ForegroundColor Gray
Write-Host "  [ ] Firewall allows your connection" -ForegroundColor Gray
Write-Host ""
Write-Host "Steps to Complete:" -ForegroundColor Yellow
Write-Host "  [ ] 1. Connect to Azure SQL as Entra ID admin" -ForegroundColor Gray
Write-Host "  [ ] 2. Open and modify: ./sql/setup-entra-users.sql" -ForegroundColor Gray
Write-Host "  [ ] 3. Uncomment CREATE USER lines with actual email addresses" -ForegroundColor Gray
Write-Host "  [ ] 4. Run the SQL script" -ForegroundColor Gray
Write-Host "  [ ] 5. Grant permissions (ALTER ROLE statements)" -ForegroundColor Gray
Write-Host "  [ ] 6. Verify users created: SELECT * FROM sys.database_principals WHERE type='E'" -ForegroundColor Gray
Write-Host "  [ ] 7. Test user can connect with their token" -ForegroundColor Gray
Write-Host "  [ ] 8. Test USER_NAME() returns their email" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentation:" -ForegroundColor Yellow
Write-Host "  - Complete Guide: ./TASK_1.5_GUIDE.md" -ForegroundColor Gray
Write-Host "  - SQL Script: ./sql/setup-entra-users.sql" -ForegroundColor Gray
Write-Host ""
Write-Host "After Completion:" -ForegroundColor Yellow
Write-Host "  Next Task: 1.6 - Implement RLS Policies" -ForegroundColor Gray
Write-Host ""
Write-Host "Need Help?" -ForegroundColor Yellow
Write-Host "  - Check TASK_1.5_GUIDE.md for troubleshooting" -ForegroundColor Gray
Write-Host "  - Common Issues section covers most problems" -ForegroundColor Gray
Write-Host ""

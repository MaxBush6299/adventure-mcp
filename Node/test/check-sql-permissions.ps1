# Check SQL Permissions for Managed Identity
# This script checks if the managed identity has been granted SQL permissions
#
# Prerequisites:
# - Azure CLI installed and authenticated
# - SqlServer PowerShell module (optional, for direct SQL queries)
#
# Usage: .\check-sql-permissions.ps1

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "rg-agentpractice4",
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerGroupName = "mssql-mcp-server",
    
    [Parameter(Mandatory=$false)]
    [string]$SqlServer = "adventureworks8700.database.windows.net",
    
    [Parameter(Mandatory=$false)]
    [string]$SqlDatabase = "adventureworks"
)

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Check SQL Permissions for Managed Identity" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

# Step 1: Get the managed identity Principal ID from the container
Write-Host "[1/3] Getting Managed Identity from container..." -ForegroundColor Yellow

$principalId = az container show `
    --resource-group $ResourceGroup `
    --name $ContainerGroupName `
    --query "identity.principalId" `
    -o tsv

if (-not $principalId) {
    Write-Host "❌ Failed to get Principal ID from container" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Principal ID: $principalId`n" -ForegroundColor Green

# Step 2: Get the display name from Azure AD
Write-Host "[2/3] Getting display name from Azure AD..." -ForegroundColor Yellow

$displayName = az ad sp show --id $principalId --query "displayName" -o tsv

if (-not $displayName) {
    Write-Host "⚠️  Could not get display name (service principal may not be visible)" -ForegroundColor Yellow
    $displayName = $ContainerGroupName
}

Write-Host "✅ Display Name: $displayName`n" -ForegroundColor Green

# Step 3: Show SQL query to check permissions
Write-Host "[3/3] SQL Query to Check Permissions`n" -ForegroundColor Yellow

$sqlQuery = @"
-- Run this query against: $SqlServer/$SqlDatabase
-- Use Azure AD authentication when connecting

-- Check if user exists
SELECT 
    name AS UserName,
    type_desc AS UserType,
    authentication_type_desc AS AuthType,
    CONVERT(VARCHAR(100), sid, 2) AS ObjectId,
    create_date AS CreatedDate
FROM sys.database_principals
WHERE type = 'E' -- External user (Azure AD)
  AND CONVERT(VARCHAR(100), sid, 2) = '$principalId';

-- Check role memberships
SELECT 
    dp.name AS UserName,
    r.name AS RoleName
FROM sys.database_principals dp
JOIN sys.database_role_members drm ON dp.principal_id = drm.member_principal_id
JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
WHERE dp.type = 'E'
  AND CONVERT(VARCHAR(100), dp.sid, 2) = '$principalId';
"@

Write-Host $sqlQuery -ForegroundColor White

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  How to Check" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "Option 1: Azure Data Studio or SQL Server Management Studio" -ForegroundColor Yellow
Write-Host "  1. Connect to: $SqlServer" -ForegroundColor White
Write-Host "  2. Database: $SqlDatabase" -ForegroundColor White
Write-Host "  3. Authentication: Azure Active Directory" -ForegroundColor White
Write-Host "  4. Run the SQL query shown above`n" -ForegroundColor White

Write-Host "Option 2: Azure Portal Query Editor" -ForegroundColor Yellow
Write-Host "  1. Go to: https://portal.azure.com" -ForegroundColor White
Write-Host "  2. Navigate to SQL Database: $SqlDatabase" -ForegroundColor White
Write-Host "  3. Open 'Query editor'" -ForegroundColor White
Write-Host "  4. Authenticate with Azure AD" -ForegroundColor White
Write-Host "  5. Run the SQL query shown above`n" -ForegroundColor White

Write-Host "Option 3: Azure CLI with Invoke-Sqlcmd (if SqlServer module installed)" -ForegroundColor Yellow
Write-Host "  Get access token and run query (see test/check-sql-permissions.sql)`n" -ForegroundColor White

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Expected Results" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "If permissions are GRANTED:" -ForegroundColor Green
Write-Host "  • First query returns 1 row with UserName matching container" -ForegroundColor White
Write-Host "  • Second query shows roles: db_datareader, db_datawriter, db_ddladmin`n" -ForegroundColor White

Write-Host "If permissions are NOT GRANTED:" -ForegroundColor Red
Write-Host "  • Both queries return 0 rows" -ForegroundColor White
Write-Host "  • Run this to grant permissions:`n" -ForegroundColor White

$grantQuery = @"
CREATE USER [$displayName-new] FROM EXTERNAL PROVIDER 
    WITH OBJECT_ID = '$principalId';

ALTER ROLE db_datareader ADD MEMBER [$displayName-new];
ALTER ROLE db_datawriter ADD MEMBER [$displayName-new];
ALTER ROLE db_ddladmin ADD MEMBER [$displayName-new];
"@

Write-Host $grantQuery -ForegroundColor Yellow

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

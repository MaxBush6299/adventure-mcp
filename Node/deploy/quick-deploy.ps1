# Quick Deployment Script for MSSQL MCP Server with RLS
# This script uses ONLY environment variables for secure deployment
# NO hardcoded credentials or configuration

# Required Environment Variables:
#   AZURE_RESOURCE_GROUP    - Azure resource group name
#   AZURE_ACR_NAME          - Azure Container Registry name
#   AZURE_LOCATION          - Azure region (e.g., westus, eastus)
#   SQL_SERVER              - SQL Server FQDN (e.g., server.database.windows.net)
#   SQL_DATABASE            - SQL Database name
#   AZURE_TENANT_ID         - Azure AD Tenant ID
#   AZURE_CLIENT_ID         - Azure AD Application (Client) ID
#   AZURE_CLIENT_SECRET     - Azure AD Client Secret
# Optional:
#   CONTAINER_GROUP_NAME    - Container group name (default: mssql-mcp-server)

# Helper function to get required environment variable
function Get-RequiredEnvVar {
    param(
        [string]$Name,
        [string]$Description,
        [switch]$IsSecret
    )
    
    $value = [System.Environment]::GetEnvironmentVariable($Name)
    
    if (-not $value) {
        Write-Host "[ERROR] Required environment variable '$Name' is not set." -ForegroundColor Red
        Write-Host "        Description: $Description" -ForegroundColor Yellow
        
        if ($IsSecret) {
            Write-Host "        Run: `$env:$Name = Read-Host -AsSecureString | ConvertFrom-SecureString" -ForegroundColor Cyan
        } else {
            Write-Host "        Run: `$env:$Name = 'your-value'" -ForegroundColor Cyan
        }
        
        return $null
    }
    
    return $value
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Secure Deployment - Environment Variable Check" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

# Collect all required variables
$missingVars = @()

Write-Host "Checking required environment variables..." -ForegroundColor Yellow

# Azure Resources
$ResourceGroup = Get-RequiredEnvVar -Name "AZURE_RESOURCE_GROUP" -Description "Azure resource group for deployment"
if (-not $ResourceGroup) { $missingVars += "AZURE_RESOURCE_GROUP" }

$AcrName = Get-RequiredEnvVar -Name "AZURE_ACR_NAME" -Description "Azure Container Registry name (without .azurecr.io)"
if (-not $AcrName) { $missingVars += "AZURE_ACR_NAME" }

$Location = Get-RequiredEnvVar -Name "AZURE_LOCATION" -Description "Azure region (e.g., westus, eastus)"
if (-not $Location) { $missingVars += "AZURE_LOCATION" }

# SQL Configuration
$SqlServerName = Get-RequiredEnvVar -Name "SQL_SERVER" -Description "SQL Server FQDN (e.g., server.database.windows.net)"
if (-not $SqlServerName) { $missingVars += "SQL_SERVER" }

$SqlDatabaseName = Get-RequiredEnvVar -Name "SQL_DATABASE" -Description "SQL Database name"
if (-not $SqlDatabaseName) { $missingVars += "SQL_DATABASE" }

# Azure AD Configuration
$AzureTenantId = Get-RequiredEnvVar -Name "AZURE_TENANT_ID" -Description "Azure AD Tenant ID (GUID)"
if (-not $AzureTenantId) { $missingVars += "AZURE_TENANT_ID" }

$AzureClientId = Get-RequiredEnvVar -Name "AZURE_CLIENT_ID" -Description "Azure AD Application (Client) ID (GUID)"
if (-not $AzureClientId) { $missingVars += "AZURE_CLIENT_ID" }

$AzureClientSecret = Get-RequiredEnvVar -Name "AZURE_CLIENT_SECRET" -Description "Azure AD Client Secret" -IsSecret
if (-not $AzureClientSecret) { $missingVars += "AZURE_CLIENT_SECRET" }

$AzureExpectedAudience = Get-RequiredEnvVar -Name "AZURE_EXPECTED_AUDIENCE" -Description "Azure AD Expected Audience (API identifier)"
if (-not $AzureExpectedAudience) { $missingVars += "AZURE_EXPECTED_AUDIENCE" }

# Optional with default
$ContainerGroupName = if ($env:CONTAINER_GROUP_NAME) { $env:CONTAINER_GROUP_NAME } else { "mssql-mcp-server" }

# Check if any required variables are missing
if ($missingVars.Count -gt 0) {
    Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Red
    Write-Host "  Missing Required Environment Variables!" -ForegroundColor Red
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Red
    
    Write-Host "Please set the following environment variables:`n" -ForegroundColor Yellow
    Write-Host "Example setup script:" -ForegroundColor Cyan
    Write-Host @"
`$env:AZURE_RESOURCE_GROUP = 'your-resource-group'
`$env:AZURE_ACR_NAME = 'your-acr-name'
`$env:AZURE_LOCATION = 'westus'
`$env:SQL_SERVER = 'your-server.database.windows.net'
`$env:SQL_DATABASE = 'your-database'
`$env:AZURE_TENANT_ID = 'your-tenant-id'
`$env:AZURE_CLIENT_ID = 'your-client-id'
`$env:AZURE_CLIENT_SECRET = 'your-client-secret'
`$env:CONTAINER_GROUP_NAME = 'mssql-mcp-server'  # Optional
"@ -ForegroundColor White
    
    Write-Host "`nOr create a setup script (not committed to git):" -ForegroundColor Yellow
    Write-Host "  1. Copy deploy/setup-env-template.ps1 to deploy/setup-env.ps1" -ForegroundColor Cyan
    Write-Host "  2. Fill in your values in deploy/setup-env.ps1" -ForegroundColor Cyan
    Write-Host "  3. Run: . .\deploy\setup-env.ps1" -ForegroundColor Cyan
    Write-Host "  4. Run: .\deploy\quick-deploy.ps1`n" -ForegroundColor Cyan
    
    exit 1
}

Write-Host "✅ All required environment variables are set!`n" -ForegroundColor Green

# Validate required parameters
if (-not $AcrName) {
    Write-Host "[ERROR] Please set `$AcrName in this script or provide it as a parameter." -ForegroundColor Red
    Write-Host "Example: `$AcrName = 'myacr'" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  MSSQL MCP Server - Quick Deployment to ACI  " -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Resource Group:    $ResourceGroup"
Write-Host "  Location:          $Location"
Write-Host "  ACR Name:          $AcrName"
Write-Host "  Container Group:   $ContainerGroupName"
Write-Host "  SQL Server:        $SqlServerName"
Write-Host "  SQL Database:      $SqlDatabaseName"
Write-Host "  Azure AD Tenant:   $AzureTenantId"
Write-Host "  Azure AD Client:   $AzureClientId"
Write-Host "  Require Auth:      true`n"

# Confirm deployment
$confirm = Read-Host "Proceed with deployment? (y/n)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

# Call the main deployment script
Write-Host "`n[INFO] Starting deployment...`n" -ForegroundColor Green

$scriptDir = Split-Path -Parent $PSCommandPath
$deployScript = Join-Path $scriptDir "deploy.ps1"

& $deployScript `
    -ResourceGroup $ResourceGroup `
    -Location $Location `
    -AcrName $AcrName `
    -ContainerGroupName $ContainerGroupName `
    -SqlServerName $SqlServerName `
    -SqlDatabaseName $SqlDatabaseName `
    -AzureTenantId $AzureTenantId `
    -AzureClientId $AzureClientId `
    -AzureClientSecret $AzureClientSecret `
    -AzureExpectedAudience $AzureExpectedAudience `
    -RequireAuth $true

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "  Deployment Complete! ✅                       " -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Green
    
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Grant SQL access to the managed identity (see output above)"
    Write-Host "  2. Test the health endpoint"
    Write-Host "  3. Run authenticated tests from test/test-task-1.7-authenticated.ps1"
    Write-Host "  4. Monitor logs: az container logs -g $ResourceGroup -n $ContainerGroupName`n"
} else {
    Write-Host "`n[ERROR] Deployment failed. Check the error messages above." -ForegroundColor Red
    exit 1
}

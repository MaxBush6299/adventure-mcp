# Quick Deployment Script for MSSQL MCP Server with RLS
# This script uses ONLY environment variables for secure deployment
# NO hardcoded credentials or configuration

# Required Environment Variables:
#   AZURE_RESOURCE_GROUP    - Azure resource group name
#   AZURE_ACR_NAME          - Azure Container Registry name
#   AZURE_LOCATION          - Azure region (e.g., westus, eastus)
#   SERVER_NAME             - SQL Server FQDN (e.g., server.database.windows.net)
#   DATABASE_NAME           - SQL Database name
#   AZURE_TENANT_ID         - Azure AD Tenant ID
#   AZURE_CLIENT_ID         - Azure AD Application (Client) ID
#   AZURE_CLIENT_SECRET     - Azure AD Client Secret
#   AZURE_EXPECTED_AUDIENCE - Azure AD Expected Audience (API identifier)
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
$SqlServerName = Get-RequiredEnvVar -Name "SERVER_NAME" -Description "SQL Server FQDN (e.g., server.database.windows.net)"
if (-not $SqlServerName) { $missingVars += "SERVER_NAME" }

$SqlDatabaseName = Get-RequiredEnvVar -Name "DATABASE_NAME" -Description "SQL Database name"
if (-not $SqlDatabaseName) { $missingVars += "DATABASE_NAME" }

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
`$env:SERVER_NAME = 'your-server.database.windows.net'
`$env:DATABASE_NAME = 'your-database'
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

# Continue with actual deployment
Write-Host "`n[INFO] Starting deployment...`n" -ForegroundColor Green

# Set default values for optional parameters
$ImageName = "mssql-mcp-server"
$ImageTag = "latest"

# Validate Azure CLI
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Azure CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

$account = az account show 2>$null
if (-not $account) {
    Write-Host "[ERROR] Not logged into Azure. Please run 'az login' first." -ForegroundColor Red
    exit 1
}

# Build and push Docker image
Write-Host "[INFO] Building Docker image..." -ForegroundColor Green

$currentDir = Get-Location
Write-Host "Current directory: $currentDir"

# Ensure Dockerfile exists
if (-not (Test-Path "Dockerfile")) {
    Write-Host "[ERROR] Dockerfile not found in current directory. Please run from Node directory." -ForegroundColor Red
    exit 1
}

# Build the image
$fullImageName = "$AcrName.azurecr.io/$ImageName`:$ImageTag"
docker build --no-cache -t $fullImageName .

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker build failed" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Logging into Azure Container Registry..." -ForegroundColor Green
az acr login --name $AcrName

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] ACR login failed" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Pushing image to ACR..." -ForegroundColor Green
docker push $fullImageName

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker push failed" -ForegroundColor Red
    exit 1
}

# Deploy container
Write-Host "[INFO] Deploying container to Azure Container Instances..." -ForegroundColor Green

# Get ACR credentials
$acrUsername = az acr credential show --name $AcrName --query "username" -o tsv
$acrPassword = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv

# Deploy using Bicep
$scriptDir = Split-Path -Parent $PSCommandPath
$bicepFile = Join-Path $scriptDir "aci-deployment.bicep"

az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $bicepFile `
    --parameters `
        containerGroupName=$ContainerGroupName `
        location=$Location `
        containerImage=$fullImageName `
        acrServer="$AcrName.azurecr.io" `
        acrUsername=$acrUsername `
        acrPassword=$acrPassword `
        sqlServerName=$SqlServerName `
        sqlDatabaseName=$SqlDatabaseName `
        readOnlyMode=$false `
        trustServerCertificate=$false `
        connectionTimeout=30 `
        azureTenantId=$AzureTenantId `
        azureClientId=$AzureClientId `
        azureClientSecret=$AzureClientSecret `
        azureExpectedAudience=$AzureExpectedAudience `
        requireAuth=$true

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Deployment failed" -ForegroundColor Red
    exit 1
}

# Get deployment outputs
Write-Host "[INFO] Retrieving deployment information..." -ForegroundColor Green

$fqdn = az deployment group show `
    --resource-group $ResourceGroup `
    --name "aci-deployment" `
    --query "properties.outputs.fqdn.value" -o tsv

$principalId = az deployment group show `
    --resource-group $ResourceGroup `
    --name "aci-deployment" `
    --query "properties.outputs.principalId.value" -o tsv

$mcpEndpoint = az deployment group show `
    --resource-group $ResourceGroup `
    --name "aci-deployment" `
    --query "properties.outputs.mcpEndpoint.value" -o tsv

$healthEndpoint = az deployment group show `
    --resource-group $ResourceGroup `
    --name "aci-deployment" `
    --query "properties.outputs.healthEndpoint.value" -o tsv

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Deployment Complete! ✅                       " -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Green

Write-Host "Container Group: $ContainerGroupName" -ForegroundColor Cyan
Write-Host "FQDN: $fqdn" -ForegroundColor Cyan
Write-Host "Principal ID (for SQL): $principalId" -ForegroundColor Cyan
Write-Host "MCP Endpoint: $mcpEndpoint" -ForegroundColor Cyan
Write-Host "Health Check: $healthEndpoint`n" -ForegroundColor Cyan

Write-Host "IMPORTANT: Grant SQL database access to the managed identity!" -ForegroundColor Yellow
Write-Host "Connect to your SQL database and run:`n" -ForegroundColor Yellow
Write-Host "CREATE USER [$ContainerGroupName] FROM EXTERNAL PROVIDER;" -ForegroundColor White
Write-Host "ALTER ROLE db_datareader ADD MEMBER [$ContainerGroupName];" -ForegroundColor White
Write-Host "ALTER ROLE db_datawriter ADD MEMBER [$ContainerGroupName];" -ForegroundColor White
Write-Host "ALTER ROLE db_ddladmin ADD MEMBER [$ContainerGroupName];`n" -ForegroundColor White
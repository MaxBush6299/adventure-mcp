# MSSQL MCP Server - Azure Container Instance Deployment Script (PowerShell)
# This script builds and deploys the containerized MCP server to Azure

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "eastus",
    
    [Parameter(Mandatory=$false)]
    [string]$AcrName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerGroupName = "mssql-mcp-server",
    
    [Parameter(Mandatory=$false)]
    [string]$SqlServerName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$SqlDatabaseName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$ImageName = "mssql-mcp-server",
    
    [Parameter(Mandatory=$false)]
    [string]$ImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$AzureTenantId = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AzureClientId = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AzureClientSecret = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AzureExpectedAudience = "",
    
    [Parameter(Mandatory=$false)]
    [bool]$RequireAuth = $true,
    
    [Parameter(Mandatory=$false)]
    [switch]$Help
)

# Configuration (set these values or pass as parameters)
if (-not $ResourceGroup) { $ResourceGroup = "" }
if (-not $AcrName) { $AcrName = "" }
if (-not $SqlServerName) { $SqlServerName = "" }
if (-not $SqlDatabaseName) { $SqlDatabaseName = "" }
if (-not $AzureTenantId) { $AzureTenantId = "" }
if (-not $AzureClientId) { $AzureClientId = "" }
if (-not $AzureClientSecret) { $AzureClientSecret = "" }

# Helper functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Test-AzureCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        Write-Error "Azure CLI is not installed. Please install it first."
        exit 1
    }

    $account = az account show 2>$null
    if (-not $account) {
        Write-Error "Not logged into Azure. Please run 'az login' first."
        exit 1
    }
}

function Test-Parameters {
    $missing = @()
    
    if (-not $ResourceGroup) { $missing += "ResourceGroup" }
    if (-not $AcrName) { $missing += "AcrName" }
    if (-not $SqlServerName) { $missing += "SqlServerName" }
    if (-not $SqlDatabaseName) { $missing += "SqlDatabaseName" }
    if (-not $AzureTenantId) { $missing += "AzureTenantId" }
    if (-not $AzureClientId) { $missing += "AzureClientId" }
    if (-not $AzureClientSecret) { $missing += "AzureClientSecret" }
    
    if ($missing.Count -gt 0) {
        Write-Error "Missing required parameters: $($missing -join ', ')"
        Show-Usage
        exit 1
    }
}

function Build-AndPushImage {
    Write-Info "Building Docker image..."
    
    # Navigate to the Node directory (current directory should already be correct)
    $currentDir = Get-Location
    Write-Info "Current directory: $currentDir"
    
    # Ensure we're in the Node directory (where Dockerfile is located)
    if (-not (Test-Path "Dockerfile")) {
        Write-Error "Dockerfile not found in current directory. Please run this script from the Node directory."
        exit 1
    }
    
    # Build the image
    $fullImageName = "$AcrName.azurecr.io/$ImageName`:$ImageTag"
    docker build -t $fullImageName .
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker build failed"
        exit 1
    }
    
    Write-Info "Logging into Azure Container Registry..."
    az acr login --name $AcrName
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ACR login failed"
        exit 1
    }
    
    Write-Info "Pushing image to ACR..."
    docker push $fullImageName
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker push failed"
        exit 1
    }
}

function Deploy-Container {
    Write-Info "Deploying container to Azure Container Instances..."
    
    # Get ACR credentials
    $acrUsername = az acr credential show --name $AcrName --query "username" -o tsv
    $acrPassword = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv
    
    # Deploy using Bicep
    $scriptDir = Split-Path -Parent $PSCommandPath
    $bicepFile = Join-Path $scriptDir "aci-deployment.bicep"
    $fullImageName = "$AcrName.azurecr.io/$ImageName`:$ImageTag"
    
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
            requireAuth=$RequireAuth
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Deployment failed"
        exit 1
    }
}

function Get-DeploymentOutputs {
    Write-Info "Retrieving deployment information..."
    
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
    
    Write-Host ""
    Write-Info "Deployment completed successfully!"
    Write-Host ""
    Write-Host "Container Group: $ContainerGroupName" -ForegroundColor Cyan
    Write-Host "FQDN: $fqdn" -ForegroundColor Cyan
    Write-Host "Principal ID (for SQL permissions): $principalId" -ForegroundColor Cyan
    Write-Host "MCP Endpoint: $mcpEndpoint" -ForegroundColor Cyan
    Write-Host "Health Check: $healthEndpoint" -ForegroundColor Cyan
    Write-Host ""
    Write-Warn "IMPORTANT: Don't forget to grant SQL database access to the managed identity!"
    Write-Host ""
    Write-Host "Connect to your SQL database and run:" -ForegroundColor Yellow
    Write-Host "CREATE USER [$ContainerGroupName] FROM EXTERNAL PROVIDER;" -ForegroundColor White
    Write-Host "ALTER ROLE db_datareader ADD MEMBER [$ContainerGroupName];" -ForegroundColor White
    Write-Host "ALTER ROLE db_datawriter ADD MEMBER [$ContainerGroupName];" -ForegroundColor White
    Write-Host "ALTER ROLE db_ddladmin ADD MEMBER [$ContainerGroupName];" -ForegroundColor White
}

function Show-Usage {
    Write-Host "MSSQL MCP Server Deployment Script" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\deploy.ps1 -ResourceGroup <rg> -AcrName <acr> -SqlServerName <server> -SqlDatabaseName <db> \"
    Write-Host "               -AzureTenantId <tenant> -AzureClientId <client> -AzureClientSecret <secret>"
    Write-Host ""
    Write-Host "Parameters:" -ForegroundColor Yellow
    Write-Host "  -ResourceGroup       Azure resource group name (required)"
    Write-Host "  -AcrName            Azure Container Registry name (required)"
    Write-Host "  -SqlServerName      SQL Server name, e.g., myserver.database.windows.net (required)"
    Write-Host "  -SqlDatabaseName    SQL Database name (required)"
    Write-Host "  -AzureTenantId      Azure AD Tenant ID (required)"
    Write-Host "  -AzureClientId      Azure AD Client/Application ID (required)"
    Write-Host "  -AzureClientSecret  Azure AD Client Secret (required)"
    Write-Host "  -Location           Azure region (default: eastus)"
    Write-Host "  -ContainerGroupName Container group name (default: mssql-mcp-server)"
    Write-Host "  -ImageName          Docker image name (default: mssql-mcp-server)"
    Write-Host "  -ImageTag           Docker image tag (default: latest)"
    Write-Host "  -RequireAuth        Require authentication (default: true)"
    Write-Host "  -Help               Show this help message"
    Write-Host ""
    Write-Host "Prerequisites:" -ForegroundColor Yellow
    Write-Host "  - Azure CLI installed and logged in (az login)"
    Write-Host "  - Docker Desktop installed and running"
    Write-Host "  - Azure Container Registry created"
    Write-Host "  - SQL Server and Database created"
    Write-Host "  - Azure AD App Registration configured (see docs/TASK_1.1_AZURE_AD_SETUP.md)"
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Green
    Write-Host "  .\deploy.ps1 -ResourceGroup 'my-rg' -AcrName 'myacr' \"
    Write-Host "               -SqlServerName 'myserver.database.windows.net' -SqlDatabaseName 'mydb' \"
    Write-Host "               -AzureTenantId '2e9b0657-...' -AzureClientId '17a97781-...' \"
    Write-Host "               -AzureClientSecret 'your-secret'"
}

# Main execution
if ($Help -or (-not $ResourceGroup -and -not $AcrName -and -not $SqlServerName -and -not $SqlDatabaseName -and -not $AzureTenantId -and -not $AzureClientId -and -not $AzureClientSecret)) {
    Show-Usage
    exit 0
}

Write-Info "Starting MSSQL MCP Server deployment..."

# Validate environment
Test-AzureCli
Test-Parameters

# Build and deploy
try {
    Build-AndPushImage
    Deploy-Container
    Get-DeploymentOutputs
    Write-Info "Deployment process completed successfully!"
} catch {
    Write-Error "Deployment failed: $_"
    exit 1
}
# Environment Variable Setup Template for Azure Deployment
# 
# INSTRUCTIONS:
# 1. Copy this file to: setup-env.ps1
# 2. Fill in your actual values in setup-env.ps1
# 3. Run: . .\deploy\setup-env.ps1
# 4. Run: .\deploy\quick-deploy.ps1
#
# WARNING: DO NOT commit setup-env.ps1 to git! It contains secrets.
#          This template file is safe to commit.

# ==========================================
# Azure Resources
# ==========================================
$env:AZURE_RESOURCE_GROUP = 'your-resource-group-name'
$env:AZURE_ACR_NAME = 'your-acr-name'  # Without .azurecr.io
$env:AZURE_LOCATION = 'westus'  # Or eastus, centralus, etc.

# ==========================================
# Container Configuration
# ==========================================
$env:CONTAINER_GROUP_NAME = 'mssql-mcp-server'  # Optional, defaults to this

# ==========================================
# Azure SQL Database
# ==========================================
$env:SQL_SERVER = 'your-server.database.windows.net'
$env:SQL_DATABASE = 'your-database-name'

# ==========================================
# Azure AD / Entra ID Configuration
# ==========================================
$env:AZURE_TENANT_ID = 'your-tenant-id-guid'
$env:AZURE_CLIENT_ID = 'your-client-id-guid'
$env:AZURE_CLIENT_SECRET = 'your-client-secret'
$env:AZURE_EXPECTED_AUDIENCE = 'api://your-client-id-guid'  # API identifier URI

Write-Host "✅ Environment variables set for deployment!" -ForegroundColor Green
Write-Host "Run: .\deploy\quick-deploy.ps1" -ForegroundColor Cyan

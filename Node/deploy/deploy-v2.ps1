# Deploy MSSQL MCP Server v2
# This script deploys the v2 container with Streamable HTTP support

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Deploy MSSQL MCP Server v2" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

# Configuration
$ResourceGroup = "rg-agentpractice4"
$Location = "eastus"
$ContainerGroupName = "mssql-mcp-server-v2"
$AcrName = "advenworks"
$AcrServer = "$AcrName.azurecr.io"
$ContainerImage = "$AcrServer/mssql-mcp-server:streamable"

# SQL Configuration
$SqlServerName = "adventureworks8700.database.windows.net"
$SqlDatabaseName = "adventureworks"

# Azure AD Configuration
# IMPORTANT: Set these as environment variables or replace with your values
$AzureTenantId = if ($env:AZURE_TENANT_ID) { $env:AZURE_TENANT_ID } else { "YOUR_TENANT_ID" }
$AzureClientId = if ($env:AZURE_CLIENT_ID) { $env:AZURE_CLIENT_ID } else { "YOUR_CLIENT_ID" }
$AzureClientSecret = if ($env:AZURE_CLIENT_SECRET) { $env:AZURE_CLIENT_SECRET } else { throw "AZURE_CLIENT_SECRET environment variable must be set" }
$AzureExpectedAudience = if ($env:AZURE_EXPECTED_AUDIENCE) { $env:AZURE_EXPECTED_AUDIENCE } else { "api://YOUR_CLIENT_ID" }

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Resource Group: $ResourceGroup" -ForegroundColor White
Write-Host "  Location: $Location" -ForegroundColor White
Write-Host "  Container: $ContainerGroupName" -ForegroundColor White
Write-Host "  Image: $ContainerImage" -ForegroundColor White
Write-Host "  SQL Server: $SqlServerName" -ForegroundColor White
Write-Host "  Database: $SqlDatabaseName" -ForegroundColor White
Write-Host "  Port: 8080 (HTTP)" -ForegroundColor Green
Write-Host ""

# Get ACR credentials
Write-Host "Getting ACR credentials..." -ForegroundColor Yellow
try {
    $acrCreds = az acr credential show --name $AcrName --query "{username:username,password:passwords[0].value}" -o json | ConvertFrom-Json
    $AcrUsername = $acrCreds.username
    $AcrPassword = $acrCreds.password
    Write-Host "✓ ACR credentials retrieved" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to get ACR credentials" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Deploy using Bicep
Write-Host "`nDeploying container instance..." -ForegroundColor Yellow
Write-Host "This may take 2-3 minutes..." -ForegroundColor Gray

$deploymentName = "mcp-v2-port80-$(Get-Date -Format 'yyyyMMddHHmmss')"

try {
    $deployment = az deployment group create `
        --resource-group $ResourceGroup `
        --template-file "./aci-deployment.bicep" `
        --parameters `
            containerGroupName=$ContainerGroupName `
            location=$Location `
            containerImage=$ContainerImage `
            acrServer=$AcrServer `
            acrUsername=$AcrUsername `
            acrPassword=$AcrPassword `
            sqlServerName=$SqlServerName `
            sqlDatabaseName=$SqlDatabaseName `
            azureTenantId=$AzureTenantId `
            azureClientId=$AzureClientId `
            azureClientSecret=$AzureClientSecret `
            azureExpectedAudience=$AzureExpectedAudience `
            requireAuth="true" `
            readOnlyMode="false" `
            trustServerCertificate="true" `
            connectionTimeout=30 `
        --name $deploymentName `
        --query "properties.outputs" `
        -o json | ConvertFrom-Json

    Write-Host "`n✓ Deployment successful!" -ForegroundColor Green
    Write-Host ""

    # Extract outputs
    $fqdn = $deployment.fqdn.value
    $ipAddress = $deployment.ipAddress.value
    $principalId = $deployment.principalId.value
    $mcpEndpoint = $deployment.mcpSseEndpoint.value

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "  Deployment Complete!" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Container Information:" -ForegroundColor Yellow
    Write-Host "  FQDN: $fqdn" -ForegroundColor White
    Write-Host "  IP Address: $ipAddress" -ForegroundColor White
    Write-Host "  Managed Identity: $principalId" -ForegroundColor White
    Write-Host ""
    Write-Host "Endpoints (Port 80):" -ForegroundColor Yellow
    Write-Host "  MCP Server: http://$fqdn/mcp" -ForegroundColor Green
    Write-Host "  Health: http://$fqdn/health" -ForegroundColor White
    Write-Host ""
    Write-Host "For Copilot Studio:" -ForegroundColor Yellow
    Write-Host "  Server URL: http://$fqdn/mcp" -ForegroundColor Cyan
    Write-Host "  Authentication: OAuth 2.0" -ForegroundColor White
    Write-Host "  Client ID: $AzureClientId" -ForegroundColor White
    Write-Host "  Tenant ID: $AzureTenantId" -ForegroundColor White
    Write-Host ""

    # Test the endpoint
    Write-Host "Testing endpoint..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10  # Give container time to start

    try {
        # Get token first
        $tokenBody = @{
            grant_type = "client_credentials"
            client_id = $AzureClientId
            client_secret = $AzureClientSecret
            scope = "$AzureExpectedAudience/.default"
        }
        $tokenResponse = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$AzureTenantId/oauth2/v2.0/token" -Method POST -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
        
        # Test MCP endpoint
        $mcpRequest = @{
            jsonrpc = "2.0"
            method = "tools/list"
            id = 1
        } | ConvertTo-Json

        $headers = @{
            'Authorization' = "Bearer $($tokenResponse.access_token)"
            'Content-Type' = 'application/json'
        }

        $mcpResponse = Invoke-RestMethod -Uri "http://$fqdn/mcp" -Method POST -Headers $headers -Body $mcpRequest
        
        Write-Host "✓ MCP endpoint responding!" -ForegroundColor Green
        Write-Host "✓ Found $($mcpResponse.result.tools.Count) tools" -ForegroundColor Green
        Write-Host ""
        Write-Host "Available tools:" -ForegroundColor Yellow
        $mcpResponse.result.tools | ForEach-Object {
            Write-Host "  - $($_.name)" -ForegroundColor White
        }
    } catch {
        Write-Host "⚠ Endpoint test failed (container may still be starting)" -ForegroundColor Yellow
        Write-Host "  Wait a minute and test manually:" -ForegroundColor Gray
        Write-Host "  curl http://$fqdn/health" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "  Next Steps" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Grant SQL permissions to managed identity:" -ForegroundColor Yellow
    Write-Host "   CREATE USER [$ContainerGroupName] FROM EXTERNAL PROVIDER;" -ForegroundColor Gray
    Write-Host "   ALTER ROLE db_datareader ADD MEMBER [$ContainerGroupName];" -ForegroundColor Gray
    Write-Host "   ALTER ROLE db_datawriter ADD MEMBER [$ContainerGroupName];" -ForegroundColor Gray
    Write-Host "   ALTER ROLE db_ddladmin ADD MEMBER [$ContainerGroupName];" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Test with Copilot Studio:" -ForegroundColor Yellow
    Write-Host "   - URL: http://$fqdn/mcp" -ForegroundColor Cyan
    Write-Host "   - Authentication: OAuth 2.0" -ForegroundColor White
    Write-Host "   - Authorization URL: https://login.microsoftonline.com/$AzureTenantId/oauth2/v2.0/authorize" -ForegroundColor Gray
    Write-Host "   - Token URL: https://login.microsoftonline.com/$AzureTenantId/oauth2/v2.0/token" -ForegroundColor Gray
    Write-Host "   - Scope: $AzureExpectedAudience/user_impersonation" -ForegroundColor Gray
    Write-Host ""

} catch {
    Write-Host "`n✗ Deployment failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        try {
            $errorDetail = $_.ErrorDetails.Message | ConvertFrom-Json
            Write-Host "`nError Details:" -ForegroundColor Yellow
            Write-Host ($errorDetail | ConvertTo-Json -Depth 5) -ForegroundColor Gray
        } catch {
            Write-Host $_.ErrorDetails.Message -ForegroundColor Gray
        }
    }
    exit 1
}

Write-Host "`nAll done!" -ForegroundColor Green
Write-Host ""

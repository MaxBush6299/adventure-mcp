# MSSQL MCP Server - Production Deployment Guide

This guide contains step-by-step instructions for deploying and troubleshooting the MSSQL MCP Server in production environments, specifically for Azure AI Projects integration.

## Complete Deployment Workflow 🔄

### Step-by-Step Production Deployment

This section provides a complete workflow for deploying and fixing common issues with Azure AI Projects integration.

#### 1. Build and Deploy Initial Version
```powershell
# Navigate to Node directory
cd Node

# Build TypeScript
npm run build

# Build Docker image
docker build -t mssql-mcp-server:latest .

# Tag for Azure Container Registry
docker tag mssql-mcp-server:latest <your-acr>.azurecr.io/mssql-mcp-server:latest

# Login to ACR
az acr login --name <your-acr>

# Push to registry
docker push <your-acr>.azurecr.io/mssql-mcp-server:latest

# Deploy using PowerShell script
.\deploy\deploy.ps1 -ResourceGroup "rg-agentpractice4" -AcrName "advenworks" -SqlServerName "adventureworks8700.database.windows.net" -SqlDatabaseName "adventureworks" -ContainerGroupName "mssql-mcp-server-v2"
```

#### 2. Test Deployment
```powershell
# Get container FQDN
$fqdn = az container show --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2" --query "ipAddress.fqdn" --output tsv

# Test health endpoint
Invoke-RestMethod -Uri "http://$fqdn:8080/health" -Method Get

# Test JSON-RPC 2.0 endpoint
Invoke-RestMethod -Uri "http://$fqdn:8080/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
```

#### 3. If Azure AI Projects Returns Errors

**Common Error: HTTP 424 with -32000 JSON-RPC Error**
This indicates the server doesn't properly support JSON-RPC 2.0.

**Common Error: HTTP 424 with 404 Not Found**
This indicates Azure AI Projects is trying to connect to an endpoint that doesn't exist.

#### 4. Update and Redeploy (If Needed)

```powershell
# After making code changes, rebuild and redeploy
npm run build
docker build -t mssql-mcp-server:latest .
docker tag mssql-mcp-server:latest <your-acr>.azurecr.io/mssql-mcp-server:latest
docker push <your-acr>.azurecr.io/mssql-mcp-server:latest

# Restart container to pull latest image
az container restart --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2"

# Wait for restart and check logs
Start-Sleep -Seconds 15
az container logs --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2"
```

#### 5. Comprehensive Endpoint Testing

Create a test script to verify all endpoints:

```powershell
# test-endpoints.ps1
$deployedUrl = "http://your-container-fqdn:8080"

# Test JSON-RPC 2.0 tools/list
$jsonrpc = Invoke-RestMethod -Uri "$deployedUrl/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
Write-Host "✅ JSON-RPC SUCCESS - Tools: $($jsonrpc.result.tools.Count)"

# Test REST endpoints
$tools = Invoke-RestMethod -Uri "$deployedUrl/tools" -Method Get
Write-Host "✅ REST /tools SUCCESS - Tools: $($tools.tools.Count)"

$toolsList = Invoke-RestMethod -Uri "$deployedUrl/tools/list" -Method Get
Write-Host "✅ REST /tools/list SUCCESS - Tools: $($toolsList.tools.Count)"

$mcpTools = Invoke-RestMethod -Uri "$deployedUrl/mcp/tools" -Method Get
Write-Host "✅ REST /mcp/tools SUCCESS - Tools: $($mcpTools.tools.Count)"

# Test health
$health = Invoke-RestMethod -Uri "$deployedUrl/health" -Method Get
Write-Host "✅ Health SUCCESS - Status: $($health.status)"
```

## Managed Identity Setup (CRITICAL) 🔐

After deploying the container with managed identity enabled, you **MUST** configure SQL permissions and Azure RBAC roles. See detailed instructions in:

- **[docs/MANAGED_IDENTITY_SETUP.md](Node/docs/MANAGED_IDENTITY_SETUP.md)** - Complete step-by-step setup guide
- **[docs/TROUBLESHOOTING.md](Node/docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[docs/FIX_SUMMARY.md](Node/docs/FIX_SUMMARY.md)** - Technical details of the authentication fix

### Quick Setup Checklist

After each deployment (when using system-assigned managed identity):

1. **Get Managed Identity Principal ID**
   ```powershell
   az container show -g <resource-group> -n <container-name> --query "identity.principalId" -o tsv
   ```

2. **Create Server-Level LOGIN** (in master database via SSMS)
   ```sql
   USE master;
   CREATE LOGIN [mssql-mcp-server] FROM EXTERNAL PROVIDER 
       WITH OBJECT_ID = '<OBJECT-ID-WITHOUT-DASHES-UPPERCASE>';
   ```

3. **Create Database-Level USER** (in target database via SSMS)
   ```sql
   USE adventureworks;
   CREATE USER [mssql-mcp-server] FROM EXTERNAL PROVIDER 
       WITH OBJECT_ID = '<OBJECT-ID-WITHOUT-DASHES-UPPERCASE>';
   ALTER ROLE db_datareader ADD MEMBER [mssql-mcp-server];
   ALTER ROLE db_datawriter ADD MEMBER [mssql-mcp-server];
   ALTER ROLE db_ddladmin ADD MEMBER [mssql-mcp-server];
   GRANT CONNECT TO [mssql-mcp-server];
   ```

4. **Grant Azure RBAC Role**
   ```powershell
   az role assignment create --role "SQL DB Contributor" --assignee "<principal-id>" --scope "<sql-server-scope>"
   ```

5. **Wait and Restart**
   ```powershell
   Start-Sleep -Seconds 180  # Wait for Azure AD propagation
   az container restart -g <resource-group> -n <container-name>
   ```

⚠️ **Important**: System-assigned managed identities are recreated on each ACI deployment, requiring you to repeat these steps. Consider using user-assigned managed identities for production.

## Azure AI Projects Configuration 🤖

```

### MCP Server URLs for Azure AI Projects

Your deployed server supports multiple endpoints that Azure AI Projects can use:

**Primary (JSON-RPC 2.0):**
```
http://your-container-fqdn:8080/mcp
```

**Alternative REST endpoints:**
```
http://your-container-fqdn:8080/tools
http://your-container-fqdn:8080/tools/list  
http://your-container-fqdn:8080/mcp/tools
```

### Expected Server Response Format

**JSON-RPC 2.0 Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "insert_data",
        "description": "Inserts data into an MSSQL Database table...",
        "inputSchema": {...}
      },
      // ... 7 more tools
    ]
  },
  "id": 1
}
```

**REST Response:**
```json
{
  "tools": [
    {
      "name": "insert_data", 
      "description": "Inserts data into an MSSQL Database table...",
      "inputSchema": {...}
    },
    // ... 7 more tools
  ]
}
```

## Advanced Troubleshooting 🔧

### Common Azure AI Projects Integration Issues

1. **JSON-RPC 2.0 Errors (-32000)**
   - Ensure server properly handles POST requests to `/mcp` endpoint
   - Verify JSON-RPC 2.0 format compliance
   - Test with: `{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}`

2. **404 Not Found Errors**
   - Check if Azure AI Projects is configured with correct endpoint URL
   - Try alternative endpoints: `/tools`, `/tools/list`, `/mcp/tools`
   - Verify container FQDN is correct and accessible

3. **Container Communication Issues**
   - Verify container has public IP and port 8080 is accessible
   - Check Azure Container Instance networking configuration
   - Test health endpoint: `curl http://<fqdn>:8080/health`

### Debugging Commands

```powershell
# Get deployment details
az container show --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2" --query "ipAddress.fqdn" --output tsv

# View container logs
az container logs --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2"

# Check container status
az container show --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2" --query "containers[0].instanceView"

# Test all endpoints at once
$fqdn = "your-container-fqdn:8080"

# Health check
try { 
    $health = Invoke-RestMethod -Uri "http://$fqdn/health"
    Write-Host "✅ Health: $($health.status)"
} catch { 
    Write-Host "❌ Health failed: $_" 
}

# JSON-RPC 2.0
try { 
    $jsonrpc = Invoke-RestMethod -Uri "http://$fqdn/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
    Write-Host "✅ JSON-RPC: $($jsonrpc.result.tools.Count) tools"
} catch { 
    Write-Host "❌ JSON-RPC failed: $_" 
}

# REST endpoints  
try { 
    $tools = Invoke-RestMethod -Uri "http://$fqdn/tools"
    Write-Host "✅ REST /tools: $($tools.tools.Count) tools"
} catch { 
    Write-Host "❌ REST /tools failed: $_" 
}

try { 
    $toolsList = Invoke-RestMethod -Uri "http://$fqdn/tools/list"
    Write-Host "✅ REST /tools/list: $($toolsList.tools.Count) tools"
} catch { 
    Write-Host "❌ REST /tools/list failed: $_" 
}

try { 
    $mcpTools = Invoke-RestMethod -Uri "http://$fqdn/mcp/tools"
    Write-Host "✅ REST /mcp/tools: $($mcpTools.tools.Count) tools"
} catch { 
    Write-Host "❌ REST /mcp/tools failed: $_" 
}
```

### Force Container Update

If the container is running an old image version:

```powershell
# Force pull latest image by recreating container
az container delete --resource-group "rg-agentpractice4" --name "mssql-mcp-server-v2" --yes

# Redeploy with latest image
.\deploy\deploy.ps1 -ResourceGroup "rg-agentpractice4" -AcrName "advenworks" -SqlServerName "adventureworks8700.database.windows.net" -SqlDatabaseName "adventureworks" -ContainerGroupName "mssql-mcp-server-v2"
```

### Log Analysis

Look for these key indicators in container logs:

**Good deployment (updated version):**
```
MCP Server running on HTTP at port 8080
Health check: http://localhost:8080/health
MCP JSON-RPC 2.0 endpoint: http://localhost:8080/mcp
MCP SSE endpoint (legacy): http://localhost:8080/mcp/sse
Tools endpoint: http://localhost:8080/mcp/tools
Introspection: http://localhost:8080/mcp/introspect
```

**Old deployment (missing JSON-RPC 2.0):**
```
MCP Server running on HTTP at port 8080
Health check: http://localhost:8080/health
MCP SSE endpoint: http://localhost:8080/mcp
MCP Message endpoint: http://localhost:8080/mcp/message
Introspection: http://localhost:8080/mcp/introspect
```

## Production Checklist ✅

Before configuring Azure AI Projects:

- [ ] Container is deployed and running
- [ ] Health endpoint returns `{"status":"healthy"}`
- [ ] JSON-RPC 2.0 endpoint returns proper `tools/list` response
- [ ] At least one REST endpoint works as backup
- [ ] Container logs show "MCP JSON-RPC 2.0 endpoint" message
- [ ] SQL Database managed identity permissions are configured
- [ ] Container has public IP accessible from Azure AI Projects

## Deployment History & Versions

### Version Notes:
- **v1.0**: Initial deployment with SSE transport only
- **v2.0**: Added JSON-RPC 2.0 support for Azure AI Projects
- **v2.1**: Added multiple REST endpoint alternatives

### Configuration Changes:
- Added POST `/mcp` endpoint for JSON-RPC 2.0
- Added GET `/tools`, `/tools/list` for REST compatibility
- Maintained backward compatibility with existing SSE transport
- Enhanced error handling and response formatting

---

*This deployment guide is specific to production environments and contains deployment-specific details. Keep this file private and update as needed for your specific Azure resources.*
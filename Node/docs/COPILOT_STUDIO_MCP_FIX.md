# How to Fix MCP Server Connection in Copilot Studio

## The Issue
When you add an MCP server in Copilot Studio and then edit it, it becomes a Custom Connector in Power Platform. The error `"[{\"jsonrpc\":\"2.0\"}]"` or `"RequestFailure:Connector request failed"` indicates that the connector isn't properly configured for MCP protocol communication.

## CRITICAL DISCOVERY: SSE Response Format Required

**The real issue**: Copilot Studio expects responses in **Server-Sent Events (SSE) format**, not plain JSON!

When comparing our MCP server with Microsoft's working MCP server (`https://learn.microsoft.com/api/mcp`), we discovered:

**Microsoft's Response:**
```
Content-Type: text/event-stream
event: message
data: {"jsonrpc":"2.0","result":{...}}
```

**Our Original Response:**
```
Content-Type: application/json
{"jsonrpc":"2.0","result":{...}}
```

**Solution**: The server now detects the `Accept: text/event-stream` header and responds in SSE format when requested. This makes it compatible with both Copilot Studio (SSE) and direct API clients (JSON).

## Quick Fix for Copilot Studio

Use the **MCP Onboarding Wizard** (simplest approach):

1. In Copilot Studio, go to **Tools** → **Add a tool** → **New tool**
2. Select **Model Context Protocol**
3. Fill in the fields:
   - **Server name**: MSSQL MCP Server
   - **Server description**: Microsoft SQL Server database operations with 16 tools including insert_data, read_data, update_data, create_table, and more
   - **Server URL**: `https://mssqlmcp.azure-api.net/mcp`
   - **Authentication**: No Authentication (for testing) or OAuth 2.0 (for production)

For OAuth 2.0 (production), use these settings:
- **Client ID**: `17a97781-0078-4478-8b4e-fe5dda9e2400`
- **Client secret**: `<YOUR_CLIENT_SECRET>`
- **Authorization URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/authorize`
- **Token URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token`
- **Refresh URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token`
- **Scopes**: `api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation`

4. Click **Create**

The server will automatically respond in SSE format, and all 16 tools should appear!

## Technical Details

### Root Cause Analysis
1. **APIM API path**: `/mcp` - This is the public-facing path
2. **APIM strips the path**: When forwarding to backend, APIM removes `/mcp` and sends to `/`
3. **Container expects**: `POST /mcp` not `POST /`
4. **Result**: 404 Not Found, which Copilot Studio shows as `"[{\"jsonrpc\":\"2.0\"}]"`

Additionally, Copilot Studio expects:
1. **Streamable HTTP transport** (not SSE, which is deprecated after August 2025)
2. **Specific OpenAPI schema** with the `x-ms-agentic-protocol: mcp-streamable-1.0` header
3. **Correct URL routing** to the `/mcp` endpoint

## Solution: Reconfigure with Correct Schema

### Step 1: Delete the Current Connector
1. In Copilot Studio, go to **Tools**
2. Find your "MSSQL MCP Server" tool
3. Delete it or note the connection details

### Step 2: Add the MCP Server

**Recommended: Use MCP Onboarding Wizard (Simplest)**

1. In Copilot Studio, go to **Tools** → **Add a tool** → **New tool**
2. Select **Model Context Protocol**
3. Fill in the fields:
   - **Server name**: MSSQL MCP Server
   - **Server description**: Microsoft SQL Server database operations with 16 tools including insert_data, read_data, update_data, create_table, and more
   - **Server URL**: `https://mssqlmcp.azure-api.net/mcp`
   - **Authentication**: OAuth 2.0
     - **Client ID**: `17a97781-0078-4478-8b4e-fe5dda9e2400`
     - **Client secret**: `<YOUR_CLIENT_SECRET>`
     - **Authorization URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/authorize`
     - **Token URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token`
     - **Refresh URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token`
     - **Scopes**: `api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation`
     - **IMPORTANT**: First, add the `user_impersonation` scope in Azure Portal → App Registration → Expose an API
4. Click **Create**

### Step 3: Verify the Configuration

After setting up, the connector should:
- Show operation `InvokeMCP` with the `x-ms-agentic-protocol: mcp-streamable-1.0` header
- Use POST method to `/mcp` endpoint
- Pass OAuth tokens correctly

### Step 4: Test in Copilot Studio

1. Go back to Copilot Studio
2. Your MCP server should now appear in the **Tools** list
3. Click on it to see the tools and resources
4. You should see all 16 database tools:
   - insert_data
   - read_data
   - update_data
   - create_table
   - create_index
   - list_table
   - drop_table
   - describe_table
   - list_stored_procedures
   - describe_stored_procedure
   - list_views
   - list_functions
   - list_schemas
   - get_table_row_count
   - list_triggers
   - generate_synthetic_data

## Key Configuration Points

### URL Structure
- ✅ **Correct**: `https://mssqlmcp.azure-api.net/mcp` (base path includes `/mcp`)
- ❌ **Wrong**: `https://mssqlmcp.azure-api.net` with base URL `/` 
- ❌ **Wrong**: `https://mssqlmcp.azure-api.net/mcp/tools`

### OpenAPI Schema Requirements
1. Must use **Swagger 2.0** format (not OpenAPI 3.0)
2. Must have `x-ms-agentic-protocol: mcp-streamable-1.0` on the POST operation
3. POST endpoint should be at root path `/` (relative to basePath)
4. Security must use OAuth 2.0 with `accessCode` flow

### OAuth Configuration
- **Flow type**: Authorization Code (not Client Credentials in the schema)
- **Scope format**: `api://17a97781-0078-4478-8b4e-fe5dda9e2400/.default`
- **Token exchange**: Must happen at runtime when user signs in

## Known Issues from Microsoft Documentation

From the official docs, be aware of:

1. **Type array truncation**: "The MCP tool definition input schema definition is truncated when a type in a tool definition is an array of multiple types instead of a single type."
   - ✅ **We fixed this**: Changed InsertDataTool to use single array type

2. **Reference types not supported**: "Tools with reference type inputs in the schema are filtered from the list of available tools for MCP server."
   - ✅ **Our tools don't use reference types**

3. **Enum interpreted as string**: "Tools with enum type inputs in the schema are interpreted as string instead of enum."
   - ⚠️ **Monitor this**: If you have enum fields, they'll be treated as strings

## Troubleshooting

### Issue: OAuth Error "AADSTS90009: Application is requesting a token for itself"
**Solution**: Your App Registration doesn't have delegated permissions configured. You need to:
1. Go to Azure Portal → Azure Active Directory → App registrations
2. Find your app: `17a97781-0078-4478-8b4e-fe5dda9e2400`
3. Click **Expose an API** in the left menu
4. Click **+ Add a scope**
5. Fill in:
   - Scope name: `user_impersonation`
   - Who can consent: **Admins and users**
   - Admin consent display name: `Access MCP Server`
   - Admin consent description: `Allow the application to access MCP Server on behalf of the signed-in user`
   - User consent display name: `Access MCP Server`
   - User consent description: `Allow the application to access MCP Server on your behalf`
   - State: **Enabled**
6. Click **Add scope**
7. Update your Copilot Studio scope to: `api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation`

### Issue: OAuth URL shows "/authoriz" instead of "/authorize" (truncated)
**Solution**: The authorization URL is being truncated. Make sure you're using the **v2.0 endpoint**:
- ❌ Wrong: `https://login.microsoftonline.com/{tenant}/oauth2/authorize`
- ✅ Correct: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`

The v2.0 endpoint is required for proper scope handling with delegated permissions.

### Issue: Still seeing `"[{\"jsonrpc\":\"2.0\"}]"` error
**Solution**: The connector is not sending requests in the correct MCP format. Verify:
1. The `x-ms-agentic-protocol: mcp-streamable-1.0` header is in the schema
2. The endpoint is POST to `/mcp`, not `/tools`
3. OAuth authentication is working (check connection test)

### Issue: Tools not appearing in Copilot Studio
**Solution**: 
1. Make sure the connector is successfully created
2. Test the connection in Power Apps first
3. Ensure the MCP server is returning tools in the correct format
4. Check that the server is accessible from Copilot Studio (network connectivity)

### Issue: OAuth redirect URI mismatch
**Solution**: Add the redirect URI shown in the error to your Azure App Registration:
```powershell
az ad app update --id 17a97781-0078-4478-8b4e-fe5dda9e2400 --web-redirect-uris "https://global.consent.azure-apim.net/redirect/*" --append
```

### Issue: 401 Unauthorized when calling tools
**Solution**: 
1. Verify the OAuth token is being passed correctly
2. Check that APIM JWT validation policy is correct
3. Ensure the token audience matches `api://17a97781-0078-4478-8b4e-fe5dda9e2400`

## Testing the MCP Endpoint

To verify your server is responding correctly, test with PowerShell:

```powershell
# Get OAuth token
$body = @{
    grant_type = "client_credentials"
    client_id = "17a97781-0078-4478-8b4e-fe5dda9e2400"
    client_secret = "<YOUR_CLIENT_SECRET>"
    resource = "api://17a97781-0078-4478-8b4e-fe5dda9e2400"
}
$response = Invoke-RestMethod -Uri "https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/token" -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"

# Test MCP initialize
$mcpRequest = @{
    jsonrpc = "2.0"
    method = "initialize"
    params = @{
        protocolVersion = "2024-11-05"
        capabilities = @{}
        clientInfo = @{
            name = "Test Client"
            version = "1.0.0"
        }
    }
    id = 1
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp" -Method POST -Headers @{
    "Authorization" = "Bearer $($response.access_token)"
    "Content-Type" = "application/json"
} -Body $mcpRequest

# Test tools/list
$toolsRequest = @{
    jsonrpc = "2.0"
    method = "tools/list"
    id = 2
} | ConvertTo-Json

$result = Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp" -Method POST -Headers @{
    "Authorization" = "Bearer $($response.access_token)"
    "Content-Type" = "application/json"
} -Body $toolsRequest

Write-Host "Found $($result.result.tools.Count) tools:"
$result.result.tools | ForEach-Object { Write-Host "  - $($_.name)" }
```

## Summary

The key insight is that **Copilot Studio requires SSE (Server-Sent Events) response format** when making MCP protocol calls. The server now automatically detects the `Accept: text/event-stream` header and responds appropriately.

Simply use the **MCP Onboarding Wizard** in Copilot Studio with the URL `https://mssqlmcp.azure-api.net/mcp` and the server will handle the rest!

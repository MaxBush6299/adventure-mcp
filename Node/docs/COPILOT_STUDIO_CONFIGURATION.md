# Copilot Studio MCP Server Configuration Guide

## 🎯 Overview

This guide provides all the information needed to configure your MSSQL MCP Server as a custom connector in Microsoft Copilot Studio.

---

## 📋 Server Information

### Server Details
- **Server Name**: MSSQL MCP Server
- **Version**: 1.0.0
- **Description**: Model Context Protocol server for Microsoft SQL Server database operations with Azure AD authentication
- **Database**: AdventureWorks on Azure SQL Database

### Available Tools (16 Total)
1. `insert_data` - Insert records into database tables
2. `read_data` - Query and retrieve data from tables
3. `update_data` - Update existing records in tables
4. `create_table` - Create new database tables
5. `create_index` - Create indexes for performance optimization
6. `list_table` - List all available tables
7. `drop_table` - Remove tables from database
8. `describe_table` - Get detailed table schema information
9. `list_stored_procedures` - List all stored procedures
10. `describe_stored_procedure` - Get stored procedure details
11. `list_views` - List all database views
12. `list_functions` - List all database functions
13. `list_schemas` - List all database schemas
14. `get_table_row_count` - Get row counts for tables
15. `list_triggers` - List all database triggers
16. `generate_synthetic_data` - Generate test data for tables

---

## 🔗 API Endpoint Configuration

### Primary APIM Gateway URL
```
https://mssqlmcp.azure-api.net/mcp
```

### Key Endpoints
- **Tools Discovery**: `GET https://mssqlmcp.azure-api.net/mcp/tools`
- **Tool Invocation**: `POST https://mssqlmcp.azure-api.net/mcp/message`
- **Health Check**: `GET https://mssqlmcp.azure-api.net/mcp/health`
- **Server Info**: `GET https://mssqlmcp.azure-api.net/mcp/introspect`

### Alternative Endpoints (if needed)
- `GET https://mssqlmcp.azure-api.net/mcp/tools/list`
- Direct Container (testing only): `http://mssql-mcp-server-hxqif63svfkuq.westus.azurecontainer.io:8080`

---

## 🔐 OAuth 2.0 Authentication Configuration

### Azure AD Application Details
- **Tenant ID**: `2e9b0657-eef8-47af-8747-5e89476faaab`
- **Application (Client) ID**: `17a97781-0078-4478-8b4e-fe5dda9e2400`
- **Application Name**: SQL Database MCP Server

### OAuth URLs
- **Authorization URL**: 
  ```
  https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/authorize
  ```

- **Token URL**: 
  ```
  https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/token
  ```

- **Token URL (v2.0)** - Alternative:
  ```
  https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token
  ```

### Authentication Parameters
- **Client ID**: `17a97781-0078-4478-8b4e-fe5dda9e2400`
- **Client Secret**: `<YOUR_CLIENT_SECRET>`
- **Resource/Scope**: `17a97781-0078-4478-8b4e-fe5dda9e2400` 
  - ⚠️ **Important**: Use just the GUID, NOT `api://17a97781-0078-4478-8b4e-fe5dda9e2400`
  - Some platforms require the `api://` prefix, others don't - try without first

### Grant Type
- **Primary**: Client Credentials (application-only authentication)
- **Alternative**: Authorization Code (if user delegation is needed)

### Token Audience
- **Expected Audience**: `api://17a97781-0078-4478-8b4e-fe5dda9e2400`
- The server accepts tokens with this audience claim

---

## 🛠️ Copilot Studio Configuration Steps

### Step 1: Add Custom Connector
1. Go to **Copilot Studio** → **Settings** → **Integrations**
2. Click **Add Custom Connector** or **Add MCP Server**
3. Choose **OAuth 2.0** as authentication method

### Step 2: Basic Information
- **Name**: MSSQL MCP Server
- **Description**: Microsoft SQL Server database operations via Model Context Protocol
- **Base URL**: `https://mssqlmcp.azure-api.net/mcp`
- **Protocol**: MCP (Model Context Protocol)

### Step 3: OAuth Configuration
Fill in the OAuth 2.0 settings:

| Field | Value |
|-------|-------|
| Authorization URL | `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/authorize` |
| Token URL | `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/token` |
| Client ID | `17a97781-0078-4478-8b4e-fe5dda9e2400` |
| Client Secret | `<YOUR_CLIENT_SECRET>` |
| Scope/Resource | `17a97781-0078-4478-8b4e-fe5dda9e2400` |

### Step 4: Test Connection
1. Click **Test Connection** or **Validate**
2. You should see all 16 tools discovered
3. Verify tools are NOT just generic "InvokeServer" operations

### Step 5: Grant Permissions
After adding the connector, you may need to:
1. Go to **Azure Portal** → **App Registrations** → SQL Database MCP Server
2. Add Copilot Studio's redirect URI if prompted
3. Grant admin consent for API permissions if required

---

## ✅ Verification Checklist

After configuration, verify:

- [ ] Connection test passes in Copilot Studio
- [ ] All 16 tools are visible (not just generic operations)
- [ ] Tool names match the list above (insert_data, read_data, etc.)
- [ ] Each tool shows proper description and parameters
- [ ] Test a simple tool like `list_table` or `list_schemas`
- [ ] Check that authentication token is being passed

---

## 🧪 Testing the Configuration

### PowerShell Test Script
```powershell
# Get OAuth token
$body = @{
    grant_type = "client_credentials"
    client_id = "17a97781-0078-4478-8b4e-fe5dda9e2400"
    client_secret = "<YOUR_CLIENT_SECRET>"
    resource = "api://17a97781-0078-4478-8b4e-fe5dda9e2400"
}

$response = Invoke-RestMethod -Uri "https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/token" -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"

# Test tools discovery
$result = Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp/tools" -Method GET -Headers @{"Authorization"="Bearer $($response.access_token)"}

Write-Host "Found $($result.tools.Count) tools:"
$result.tools | ForEach-Object { Write-Host "  ✓ $($_.name)" }
```

Expected output: 16 tools listed

---

## 🔧 Troubleshooting

### Issue: Can't see any tools or only see generic operations
**Solution**: Check that the MCP endpoint is `/mcp/tools` not just `/mcp`

### Issue: 401 Unauthorized error
**Solutions**:
1. Verify client secret is correct (not expired)
2. Check that resource/scope matches the audience expected by server
3. Ensure token is being sent in Authorization header as `Bearer <token>`

### Issue: Tools visible but calls fail
**Solutions**:
1. Check that user/app has permissions to the SQL database
2. Verify network connectivity from Copilot Studio to APIM
3. Check APIM policy is allowing requests through

### Issue: "Invalid audience" error
**Solution**: Make sure you're requesting a token with `resource=api://17a97781-0078-4478-8b4e-fe5dda9e2400`

### Issue: Copilot Studio shows wrong redirect URI
**Solution**: Add the redirect URI shown in the error to Azure App Registration

---

## 📞 Support Information

### Azure Resources
- **Resource Group**: `rg-agentpractice4`
- **APIM Instance**: `mssqlmcp`
- **Container Instance**: `mssql-mcp-server`
- **Container Registry**: `advenworks.azurecr.io`
- **SQL Server**: `adventureworks8700.database.windows.net`
- **Database**: `adventureworks`

### Logs and Monitoring
- **Container Logs**: `az container logs --name mssql-mcp-server --resource-group rg-agentpractice4`
- **APIM Logs**: Check in Azure Portal → APIM → APIs → MCP Server API → Diagnostics

---

## 🔄 Recent Changes

### October 13, 2025
- ✅ Fixed CORS policy (removed wildcard with credentials)
- ✅ Disabled APIM subscription key requirement
- ✅ Added application token support (client credentials flow)
- ✅ Updated TokenValidator to handle both user and app tokens
- ✅ Verified all 16 tools working through APIM with OAuth

### Key Fix
The server now supports **both** authentication methods:
- **User tokens** (delegated permissions) - for user-specific operations
- **Application tokens** (client credentials) - for app-to-app scenarios like Copilot Studio

---

## 📚 Additional Resources

- **MCP Specification**: https://modelcontextprotocol.io/
- **Azure API Management**: https://learn.microsoft.com/azure/api-management/
- **OAuth 2.0 Client Credentials**: https://learn.microsoft.com/azure/active-directory/develop/v2-oauth2-client-creds-grant-flow
- **Repository**: https://github.com/MaxBush6299/adventure-mcp

---

**Last Updated**: October 13, 2025  
**Status**: ✅ Production Ready

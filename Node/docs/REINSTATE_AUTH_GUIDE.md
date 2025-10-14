# Guide: Reinstating Azure AD Authentication

## Overview
This guide walks you through the steps to re-enable OAuth 2.0 authentication in your MCP server deployment, transitioning from the current testing setup (authentication disabled) to a production-ready configuration.

## Current State
- **Container**: `mssql-mcp-server-v2` running with `REQUIRE_AUTH=false`
- **APIM**: JWT validation disabled (testing mode)
- **SQL Connection**: Global pool using managed identity (no per-user context)

## Target State
- **Container**: Per-user authentication with JWT token validation
- **APIM**: Full OAuth 2.0 flow with JWT validation enabled
- **SQL Connection**: Per-user connection pools using On-Behalf-Of (OBO) token exchange

---

## Step 1: Rotate the Exposed Client Secret

**Why**: A client secret was previously exposed in git history and needs to be rotated for security.

### 1.1 Create New Client Secret

```powershell
# Login to Azure
az login

# Create new client secret
$newSecret = az ad app credential reset --id 17a97781-0078-4478-8b4e-fe5dda9e2400 --append --query password -o tsv

# Display the new secret (save this securely!)
Write-Host "New Client Secret: $newSecret" -ForegroundColor Green
Write-Host "Save this secret immediately - it won't be shown again!" -ForegroundColor Yellow
```

### 1.2 Update Environment Variables

```powershell
# Update your local .env file
cd "Node"
# Edit .env and update AZURE_CLIENT_SECRET with the new value

# Update Azure Key Vault (if using)
az keyvault secret set --vault-name <your-keyvault> --name azure-client-secret --value $newSecret
```

### 1.3 Delete Old Secret (After Testing New One)

```powershell
# List all secrets to find the old one's key ID
az ad app credential list --id 17a97781-0078-4478-8b4e-fe5dda9e2400

# Delete the old secret by key ID
az ad app credential delete --id 17a97781-0078-4478-8b4e-fe5dda9e2400 --key-id <old-key-id>
```

---

## Step 2: Configure Azure AD App Registration

### 2.1 Verify Exposed API Scope

Ensure the `user_impersonation` scope exists:

```powershell
# Check existing scopes
az ad app show --id 17a97781-0078-4478-8b4e-fe5dda9e2400 --query "api.oauth2PermissionScopes"
```

If not present, add it:

1. Go to [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations**
2. Find app: `17a97781-0078-4478-8b4e-fe5dda9e2400`
3. Click **Expose an API**
4. Click **+ Add a scope**
5. Fill in:
   - **Scope name**: `user_impersonation`
   - **Who can consent**: Admins and users
   - **Admin consent display name**: `Access MCP Server`
   - **Admin consent description**: `Allow the application to access MCP Server on behalf of the signed-in user`
   - **User consent display name**: `Access MCP Server`
   - **User consent description**: `Allow the application to access MCP Server on your behalf`
   - **State**: Enabled
6. Click **Add scope**

### 2.2 Add Required API Permissions

The app needs permission to call SQL Database on behalf of users:

```powershell
# Add Azure SQL Database delegated permission
az ad app permission add --id 17a97781-0078-4478-8b4e-fe5dda9e2400 \
    --api 022907d3-0f1b-48f7-badc-1ba6abab6d66 \
    --api-permissions c39ef2d1-04ce-46dc-8b5f-e9a5c60f0fc9=Scope

# Grant admin consent (if you're admin)
az ad app permission grant --id 17a97781-0078-4478-8b4e-fe5dda9e2400 \
    --api 022907d3-0f1b-48f7-badc-1ba6abab6d66
```

**Note**: `022907d3-0f1b-48f7-badc-1ba6abab6d66` is Azure SQL Database's app ID.

### 2.3 Configure Redirect URIs

Add redirect URIs for Copilot Studio and APIM:

```powershell
# Add redirect URIs
az ad app update --id 17a97781-0078-4478-8b4e-fe5dda9e2400 \
    --web-redirect-uris \
        "https://global.consent.azure-apim.net/redirect" \
        "https://global.consent.azure-apim.net/redirect/*" \
        "https://login.microsoftonline.com/common/oauth2/nativeclient"
```

---

## Step 3: Update APIM Policy

### 3.1 Enable JWT Validation

Edit your APIM policy to uncomment the JWT validation block:

```xml
<policies>
    <inbound>
        <base />
        
        <!-- Enable JWT Validation -->
        <validate-jwt header-name="Authorization" failed-validation-httpcode="401" failed-validation-error-message="Unauthorized. Access token is missing or invalid.">
            <openid-config url="https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/v2.0/.well-known/openid-configuration" />
            <audiences>
                <audience>api://17a97781-0078-4478-8b4e-fe5dda9e2400</audience>
            </audiences>
            <required-claims>
                <claim name="scp" match="any">
                    <value>user_impersonation</value>
                </claim>
            </required-claims>
        </validate-jwt>

        <!-- Forward Authorization header to backend -->
        <set-header name="Authorization" exists-action="override">
            <value>@(context.Request.Headers.GetValueOrDefault("Authorization", ""))</value>
        </set-header>

        <!-- Remove testing header -->
        <!-- <set-header name="X-Validation-Disabled" exists-action="delete" /> -->

        <set-backend-service base-url="http://4.156.202.65:8080" />
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

### 3.2 Apply Policy Changes

```powershell
# Navigate to APIM in Azure Portal
# Or use Azure CLI
az apim api operation policy create \
    --resource-group <your-rg> \
    --service-name <your-apim> \
    --api-id mssql-mcp \
    --operation-id "*" \
    --policy-format xml \
    --policy-content @policy.xml
```

---

## Step 4: Redeploy Container with Authentication Enabled

### 4.1 Update Deployment Script

The `deploy-v2.ps1` script already supports authentication. Just set the parameters:

```powershell
cd "Node\deploy"

# Set environment variables with NEW secret
$env:AZURE_CLIENT_SECRET = "<your-new-secret-from-step-1>"
$env:AZURE_TENANT_ID = "2e9b0657-eef8-47af-8747-5e89476faaab"
$env:AZURE_CLIENT_ID = "17a97781-0078-4478-8b4e-fe5dda9e2400"
$env:AZURE_EXPECTED_AUDIENCE = "api://17a97781-0078-4478-8b4e-fe5dda9e2400"

# Deploy with authentication enabled
.\deploy-v2.ps1
```

### 4.2 Verify Container Configuration

The deployment will set:
- `REQUIRE_AUTH=true` - Enable JWT validation in container
- `AZURE_TENANT_ID` - Your tenant ID
- `AZURE_CLIENT_ID` - Your app registration client ID
- `AZURE_CLIENT_SECRET` - Your NEW client secret (for OBO flow)
- `AZURE_EXPECTED_AUDIENCE` - Expected token audience

### 4.3 Container Behavior with Auth Enabled

With `REQUIRE_AUTH=true`:
1. Container validates JWT token from `Authorization` header
2. Extracts user identity (OID, UPN, email) from token claims
3. Uses OBO flow to exchange user token for SQL Database token
4. Creates per-user connection pool with user's SQL context
5. Executes queries with user's identity (RLS enforced)

---

## Step 5: Update SQL Database for Per-User Access

### 5.1 Create Azure AD Users in SQL

Each user needs a SQL user account:

```sql
-- Connect to your SQL Database as Azure AD admin

-- Create user for specific Azure AD user
CREATE USER [user@domain.com] FROM EXTERNAL PROVIDER;
GRANT db_datareader TO [user@domain.com];
GRANT db_datawriter TO [user@domain.com];
GRANT db_ddladmin TO [user@domain.com];
GRANT EXECUTE TO [user@domain.com];
GRANT VIEW DEFINITION TO [user@domain.com];
GO

-- Or create user for Azure AD group
CREATE USER [YourAzureADGroup] FROM EXTERNAL PROVIDER;
GRANT db_datareader TO [YourAzureADGroup];
GRANT db_datawriter TO [YourAzureADGroup];
-- etc.
GO
```

### 5.2 Configure Row-Level Security (Optional)

If you want RLS based on user context:

```sql
-- Create security predicate function
CREATE FUNCTION dbo.fn_securitypredicate(@Username AS nvarchar(256))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_securitypredicate_result
WHERE @Username = USER_NAME();
GO

-- Create security policy
CREATE SECURITY POLICY dbo.UserFilter
ADD FILTER PREDICATE dbo.fn_securitypredicate(Username)
ON dbo.YourTable
WITH (STATE = ON);
GO
```

See `RLS_IMPLEMENTATION_PLAN.md` for detailed RLS setup.

---

## Step 6: Test Authentication Flow

### 6.1 Get User OAuth Token

```powershell
# Test OAuth flow to get user token
$authUrl = "https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/authorize?client_id=17a97781-0078-4478-8b4e-fe5dda9e2400&response_type=code&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient&scope=api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation"

Write-Host "Open this URL in browser to get authorization code:" -ForegroundColor Yellow
Write-Host $authUrl

# After getting code from redirect URL, exchange for token
$code = Read-Host "Enter authorization code"

$tokenBody = @{
    grant_type = "authorization_code"
    client_id = "17a97781-0078-4478-8b4e-fe5dda9e2400"
    client_secret = $env:AZURE_CLIENT_SECRET
    code = $code
    redirect_uri = "https://login.microsoftonline.com/common/oauth2/nativeclient"
    scope = "api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation"
}

$tokenResponse = Invoke-RestMethod -Uri "https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token" -Method POST -Body $tokenBody -ContentType "application/x-www-form-urlencoded"

$userToken = $tokenResponse.access_token
Write-Host "User token acquired!" -ForegroundColor Green
```

### 6.2 Test MCP Server with User Token

```powershell
# Test initialize
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

$result = Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $userToken"
        "Content-Type" = "application/json"
    } `
    -Body $mcpRequest

Write-Host "Initialize result:" -ForegroundColor Green
$result | ConvertTo-Json -Depth 3

# Test list_table tool
$toolRequest = @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "list_table"
        arguments = @{}
    }
    id = 2
} | ConvertTo-Json -Depth 10

$toolResult = Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $userToken"
        "Content-Type" = "application/json"
    } `
    -Body $toolRequest

Write-Host "List tables result:" -ForegroundColor Green
$toolResult.result.content[0].text | ConvertFrom-Json | ConvertTo-Json -Depth 3
```

### 6.3 Verify Per-User Context

Check the container logs to see user context:

```powershell
az container logs --resource-group rg-agentpractice4 --name mssql-mcp-server-v2 --tail 50
```

You should see log entries showing:
- JWT validation success
- User identity extracted (OID, UPN, email)
- OBO token exchange
- SQL connection with user context

---

## Step 7: Update Copilot Studio Configuration

### 7.1 Reconfigure MCP Server in Copilot Studio

1. Go to Copilot Studio → **Tools**
2. Find "MSSQL MCP Server" tool
3. Click **Edit** (or delete and recreate)
4. Update OAuth settings:
   - **Client secret**: Use your NEW secret from Step 1
   - **Scopes**: `api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation`
   - **Authorization URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/authorize`
   - **Token URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token`
   - **Refresh URL**: `https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/oauth2/v2.0/token`
5. Save changes

### 7.2 Test in Copilot Studio

1. Create a test agent
2. Add your MSSQL MCP Server tool
3. Try a query: "List all tables in the database"
4. Verify the agent prompts for authentication
5. Sign in with your Azure AD account
6. Verify the query returns results

---

## Summary Checklist

- [ ] **Step 1**: Rotate exposed client secret in Azure AD
- [ ] **Step 2**: Configure Azure AD app (scope, permissions, redirect URIs)
- [ ] **Step 3**: Enable JWT validation in APIM policy
- [ ] **Step 4**: Redeploy container with `REQUIRE_AUTH=true`
- [ ] **Step 5**: Create SQL users for Azure AD accounts
- [ ] **Step 6**: Test authentication flow with user token
- [ ] **Step 7**: Update Copilot Studio with new OAuth settings
- [ ] **Verify**: End-to-end test with authenticated user

---

## Benefits of Authentication

**Security**:
- ✅ User identity verified via Azure AD
- ✅ Per-user authorization (SQL permissions)
- ✅ Audit trail with user context
- ✅ Row-Level Security enforcement

**Functionality**:
- ✅ Per-user connection pooling
- ✅ User-specific data access
- ✅ Compliance with data governance policies
- ✅ Integration with Azure AD groups

**Production-Ready**:
- ✅ OAuth 2.0 standard authentication
- ✅ Token refresh handling
- ✅ Proper error handling for auth failures
- ✅ Logging and monitoring of user actions

---

## Troubleshooting

### Issue: "Token validation failed"

**Check**:
1. Token audience matches `api://17a97781-0078-4478-8b4e-fe5dda9e2400`
2. Token not expired (check `exp` claim)
3. APIM JWT validation policy uses correct tenant and client ID

### Issue: "OBO exchange failed"

**Check**:
1. Client secret is correct
2. App has `user_impersonation` scope exposed
3. App has API permission for Azure SQL Database (delegated)
4. User has consented to the scope

### Issue: "Login failed for user"

**Check**:
1. SQL Database has Azure AD admin configured
2. User exists in SQL Database (`CREATE USER FROM EXTERNAL PROVIDER`)
3. User has required permissions (db_datareader, etc.)
4. Firewall allows Azure service access

### Issue: "Scope not found in token"

**Check**:
1. Authorization URL includes correct scope parameter
2. User consented to the `user_impersonation` scope
3. Token was acquired with correct scope (not `.default`)

---

## Additional Resources

- [Azure AD OAuth 2.0 Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
- [Azure SQL Database Azure AD Authentication](https://docs.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-overview)
- [APIM JWT Validation Policy](https://docs.microsoft.com/en-us/azure/api-management/validate-jwt-policy)
- [Row-Level Security in SQL Database](https://docs.microsoft.com/en-us/sql/relational-databases/security/row-level-security)

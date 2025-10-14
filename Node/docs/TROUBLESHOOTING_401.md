# Troubleshooting: 401 Unauthorized with User Token

## Issue
Even with a valid user token containing `user_impersonation` scope, APIM returns 401 Unauthorized.

## Possible Causes & Solutions

### 1. APIM Policy Not Applied Correctly
**Check:**
- Go to Azure Portal → APIM → APIs → MCP Server API
- Click "All operations"
- Look at "Inbound processing" section
- Verify the `<validate-jwt>` block is present

**Solution:**
If policy is missing or incorrect:
1. Click the `</>` code icon
2. Replace entire policy with content from `Node/deploy/apim-policy-auth-enabled.xml`
3. Click Save
4. Wait 10-30 seconds for policy to propagate

### 2. Policy Applied to Wrong Scope
**Check:**
- Policy must be on "All operations" (API level)
- Not on individual operations (GET /mcp, POST /mcp, etc.)

**Solution:**
1. Remove policies from individual operations
2. Apply policy only to "All operations"

### 3. Token Audience Mismatch
**Check token claims:**
```powershell
$tokenParts = $global:userToken.Split('.')
$payload = $tokenParts[1]
$paddedPayload = $payload + ('=' * ((4 - ($payload.Length % 4)) % 4))
$decodedBytes = [System.Convert]::FromBase64String($paddedPayload)
$decodedJson = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
$claims = $decodedJson | ConvertFrom-Json
$claims | ConvertTo-Json
```

**Expected values:**
- `aud`: `api://17a97781-0078-4478-8b4e-fe5dda9e2400`
- `scp`: `user_impersonation`
- `iss`: `https://sts.windows.net/2e9b0657-eef8-47af-8747-5e89476faaab/`

### 4. APIM Subscription Key Required
**Check:**
If APIM has subscription key requirement enabled:

```powershell
az apim api show --resource-group rg-agentpractice4 --service-name mssqlmcp --api-id mcp-server-api --query subscriptionRequired
```

**Solution:**
If `true`, either:
- Add subscription key header: `Ocp-Apim-Subscription-Key: YOUR_KEY`
- Or disable: `az apim api update --resource-group rg-agentpractice4 --service-name mssqlmcp --api-id mcp-server-api --subscription-required false`

### 5. Cached Policy
**Issue:**
APIM may cache old policy for a short time.

**Solution:**
Wait 30-60 seconds after saving policy, then test again.

### 6. CORS Policy Interference
**Check:**
Look for `<cors>` policy that might be rejecting requests.

**Solution:**
Ensure CORS allows your origin:
```xml
<cors allow-credentials="true">
    <allowed-origins>
        <origin>*</origin>
    </allowed-origins>
    <allowed-methods>
        <method>*</method>
    </allowed-methods>
    <allowed-headers>
        <header>*</header>
    </allowed-headers>
</cors>
```

### 7. Backend Service URL Wrong
**Check policy:**
```xml
<set-backend-service base-url="http://4.156.202.65:8080" />
```

**Verify container IP:**
```powershell
az container show --resource-group rg-agentpractice4 --name mssql-mcp-server-v2 --query "ipAddress.ip" -o tsv
```

If IP changed, update policy with new IP.

### 8. OpenID Configuration URL Issue
**Check:**
```xml
<openid-config url="https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/v2.0/.well-known/openid-configuration" />
```

**Test URL:**
```powershell
Invoke-RestMethod -Uri "https://login.microsoftonline.com/2e9b0657-eef8-47af-8747-5e89476faaab/v2.0/.well-known/openid-configuration"
```

Should return issuer, token_endpoint, jwks_uri, etc.

## Testing Directly (Bypass APIM)

To isolate if issue is APIM or container:

```powershell
# Get container IP
$containerIp = az container show --resource-group rg-agentpractice4 --name mssql-mcp-server-v2 --query "ipAddress.ip" -o tsv

# Test directly
$mcpRequest = @{ jsonrpc = "2.0"; method = "tools/list"; id = 1 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://${containerIp}:8080/mcp" -Method POST -Headers @{
    "Authorization" = "Bearer $global:userToken"
    "Content-Type" = "application/json"
} -Body $mcpRequest
```

**If this works:**
- Problem is in APIM policy
- Review policy configuration

**If this fails:**
- Problem is in container
- Check container logs: `az container logs --resource-group rg-agentpractice4 --name mssql-mcp-server-v2`

## Alternative: Test with No Authentication Temporarily

To verify APIM routing works:

1. Comment out JWT validation in policy:
```xml
<!--
<validate-jwt header-name="Authorization" ...>
    ...
</validate-jwt>
-->
```

2. Test without token:
```powershell
$mcpRequest = @{ jsonrpc = "2.0"; method = "tools/list"; id = 1 } | ConvertTo-Json
Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp" -Method POST -Headers @{
    "Content-Type" = "application/json"
} -Body $mcpRequest
```

**If this works:**
- APIM routing is fine
- Problem is JWT validation configuration

**If this fails:**
- Problem is APIM routing or backend connectivity

## Get APIM Logs

Enable diagnostic logging:

```powershell
# Check if Application Insights is configured
az apim api diagnostic show --resource-group rg-agentpractice4 --service-name mssqlmcp --api-id mcp-server-api --diagnostic-id applicationinsights
```

Logs will show exactly why APIM is returning 401.

## Final Checklist

- [ ] Policy applied to "All operations"
- [ ] Policy contains `<validate-jwt>` block
- [ ] `<audiences>` contains `api://17a97781-0078-4478-8b4e-fe5dda9e2400`
- [ ] `<required-claims>` requires `scp` with `user_impersonation`
- [ ] Backend URL points to correct container IP
- [ ] Token has `aud` claim matching audience
- [ ] Token has `scp` claim with `user_impersonation`
- [ ] Waited 30+ seconds after saving policy
- [ ] Subscription key not required (or provided if required)

## Contact Info

If all else fails, the issue might be:
- APIM managed identity permissions
- Azure AD app registration missing permissions
- Network security group blocking traffic

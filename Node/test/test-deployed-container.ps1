# Test script for deployed Azure Container Instance
# Tests authentication and RLS functionality

param(
    [string]$ContainerFQDN = "mssql-mcp-server-hxqif63svfkuq.westus.azurecontainer.io",
    [int]$Port = 8080
)

$baseUrl = "http://${ContainerFQDN}:${Port}"

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Testing Deployed MCP Server with Authentication" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "Container URL: $baseUrl" -ForegroundColor Yellow
Write-Host "Test User: mb6299@MngEnvMCAP095199.onmicrosoft.com`n" -ForegroundColor Yellow

# Get test user credentials from environment
$tenantId = $env:AZURE_TENANT_ID
$clientId = $env:AZURE_CLIENT_ID
$clientSecret = $env:AZURE_CLIENT_SECRET
$testUsername = "mb6299@MngEnvMCAP095199.onmicrosoft.com"
$testPassword = "Grumpy8700!"  # This should be in environment variable for production

if (-not $tenantId -or -not $clientId -or -not $clientSecret) {
    Write-Host "[ERROR] Missing Azure AD environment variables." -ForegroundColor Red
    Write-Host "Please run: . .\deploy\setup-env.ps1" -ForegroundColor Yellow
    exit 1
}

# Step 1: Get access token using Resource Owner Password Credentials (ROPC) flow
Write-Host "[1/4] Getting access token for test user..." -ForegroundColor Cyan

$tokenUrl = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"
$tokenBody = @{
    grant_type = "password"
    client_id = $clientId
    client_secret = $clientSecret
    username = $testUsername
    password = $testPassword
    scope = "$clientId/.default"
}

try {
    $tokenResponse = Invoke-RestMethod -Method Post -Uri $tokenUrl -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
    $accessToken = $tokenResponse.access_token
    Write-Host "✅ Token acquired successfully (expires in $($tokenResponse.expires_in)s)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to get token: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nNote: ROPC may be blocked by MFA or Conditional Access policies." -ForegroundColor Yellow
    exit 1
}

# Step 2: Test health endpoint (may require auth)
Write-Host "`n[2/4] Testing health endpoint..." -ForegroundColor Cyan

try {
    $headers = @{
        "Authorization" = "Bearer $accessToken"
    }
    $healthResponse = Invoke-RestMethod -Method Get -Uri "$baseUrl/health" -Headers $headers
    Write-Host "✅ Health check passed: $($healthResponse | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 3: Test reading documents (RLS should filter to user's documents only)
Write-Host "`n[3/4] Testing RLS - Read Documents..." -ForegroundColor Cyan

$readRequest = @{
    jsonrpc = "2.0"
    id = 1
    method = "tools/call"
    params = @{
        name = "query_sql"
        arguments = @{
            query = "SELECT DocumentID, Title, OwnerUPN FROM Security.Documents ORDER BY DocumentID"
        }
    }
} | ConvertTo-Json -Depth 10

try {
    $headers = @{
        "Authorization" = "Bearer $accessToken"
        "Content-Type" = "application/json"
    }
    $readResponse = Invoke-RestMethod -Method Post -Uri "$baseUrl/mcp/message" -Headers $headers -Body $readRequest
    
    if ($readResponse.result) {
        Write-Host "✅ Query executed successfully!" -ForegroundColor Green
        Write-Host "`nResults (filtered by RLS):" -ForegroundColor Cyan
        $readResponse.result.content | ForEach-Object {
            Write-Host $_.text
        }
    } else {
        Write-Host "⚠️  Unexpected response format" -ForegroundColor Yellow
        Write-Host ($readResponse | ConvertTo-Json -Depth 10)
    }
} catch {
    Write-Host "❌ Read test failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Yellow
    }
}

# Step 4: Test insert (should succeed for user's own documents)
Write-Host "`n[4/4] Testing RLS - Insert Document..." -ForegroundColor Cyan

$insertRequest = @{
    jsonrpc = "2.0"
    id = 2
    method = "tools/call"
    params = @{
        name = "execute_sql"
        arguments = @{
            query = "INSERT INTO Security.Documents (Title, OwnerUPN) VALUES ('Test from ACI', 'mb6299@MngEnvMCAP095199.onmicrosoft.com'); SELECT @@ROWCOUNT as RowsInserted"
        }
    }
} | ConvertTo-Json -Depth 10

try {
    $insertResponse = Invoke-RestMethod -Method Post -Uri "$baseUrl/mcp/message" -Headers $headers -Body $insertRequest
    
    if ($insertResponse.result) {
        Write-Host "✅ Insert succeeded!" -ForegroundColor Green
        Write-Host ($insertResponse.result.content | ForEach-Object { $_.text })
    } else {
        Write-Host "⚠️  Unexpected response format" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Insert test failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Test Complete!" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "Container Logs:" -ForegroundColor Yellow
Write-Host "  az container logs -g rg-agentpractice4 -n mssql-mcp-server`n" -ForegroundColor White

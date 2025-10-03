# Get Application Token for MCP Server using Client Credentials
# This gets an app-only token (not a user token), which the server can then use for OBO

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Get App Token - Client Credentials" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Load environment variables from .env file
$envPath = "..\.env"
if (Test-Path $envPath) {
    Write-Host "Loading environment variables from .env..." -ForegroundColor Yellow
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $value, [System.EnvironmentVariableTarget]::Process)
        }
    }
}

$tenantId = $env:AZURE_TENANT_ID
$clientId = $env:AZURE_CLIENT_ID
$clientSecret = $env:AZURE_CLIENT_SECRET

if (-not $tenantId -or -not $clientId -or -not $clientSecret) {
    Write-Host "Error: Missing Azure credentials in .env file" -ForegroundColor Red
    exit 1
}

Write-Host "Tenant ID: $tenantId"
Write-Host "Client ID: $clientId"
Write-Host ""

# For the MCP server, we actually need a USER token (delegated permissions),
# not an app-only token. The user token needs to have the MCP app as its audience.

Write-Host "Note: Testing authentication flow..." -ForegroundColor Yellow
Write-Host "We need a token WITH our app as the audience" -ForegroundColor Yellow
Write-Host ""
Write-Host "The token flow should be:" -ForegroundColor Cyan
Write-Host "  1. User authenticates and gets token FOR our app (audience = $clientId)" -ForegroundColor Gray
Write-Host "  2. User sends that token to MCP server" -ForegroundColor Gray  
Write-Host "  3. Server validates token (checks audience = $clientId)" -ForegroundColor Gray
Write-Host "  4. Server uses OBO to exchange for SQL token" -ForegroundColor Gray
Write-Host ""

# For testing, let's try getting a client credentials token first
# (This won't work with OBO, but let's see what the server says)
$tokenEndpoint = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"

Write-Host "Getting client credentials token..." -ForegroundColor Yellow

try {
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = "$clientId/.default"
        grant_type    = "client_credentials"
    }
    
    $response = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType "application/x-www-form-urlencoded"
    
    $token = $response.access_token
    
    Write-Host "Token acquired!" -ForegroundColor Green
    Write-Host ""
    
    # Parse token
    $tokenParts = $token.Split('.')
    $payload = $tokenParts[1]
    $padding = 4 - ($payload.Length % 4)
    if ($padding -ne 4) {
        $payload += "=" * $padding
    }
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload)) | ConvertFrom-Json
    
    Write-Host "Token Details:"
    Write-Host "  Audience: $($payloadJson.aud)"
    Write-Host "  App ID: $($payloadJson.appid)"
    Write-Host "  Type: App-only (no user context)"
    $expiryDate = (Get-Date "1970-01-01 00:00:00").AddSeconds($payloadJson.exp)
    Write-Host "  Expires: $expiryDate"
    Write-Host ""
    
    Write-Host "WARNING: This is an app-only token (no user)!" -ForegroundColor Yellow
    Write-Host "It won't work with OBO flow which requires a user token." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For user-based testing, you need:" -ForegroundColor Yellow
    Write-Host "  - Interactive authentication (browser-based)" -ForegroundColor Gray
    Write-Host "  - or ROPC flow with username/password" -ForegroundColor Gray
    Write-Host ""
    
    # Save it anyway for testing
    $env:TEST_USER_TOKEN = $token
    $token | Out-File -FilePath "test-app-token.txt" -NoNewline
    Write-Host "Token saved to test-app-token.txt" -ForegroundColor Green
    
} catch {
    Write-Host "Error obtaining token:" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "  Error: $($errorJson.error)" -ForegroundColor Yellow
        Write-Host "  Description: $($errorJson.error_description)" -ForegroundColor Yellow
    } else {
        Write-Host $_.Exception.Message -ForegroundColor Yellow
    }
    exit 1
}

param(
    [Parameter(Mandatory=$false)]
    [string]$EnvFile = ".env"
)

Write-Host "Testing Azure AD App Registration Configuration" -ForegroundColor Cyan
Write-Host "=" * 60
Write-Host ""

# Load .env file
if (Test-Path $EnvFile) {
    Write-Host "Loading environment variables from $EnvFile" -ForegroundColor Green
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.+)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "env:$name" -Value $value
        }
    }
} else {
    Write-Host ".env file not found at: $EnvFile" -ForegroundColor Red
    exit 1
}

# Get values from environment
$tenantId = $env:AZURE_TENANT_ID
$clientId = $env:AZURE_CLIENT_ID
$clientSecret = $env:AZURE_CLIENT_SECRET

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Tenant ID: $tenantId"
Write-Host "  Client ID: $clientId"
Write-Host "  Client Secret: $($clientSecret.Substring(0, 10))..." -ForegroundColor Gray
Write-Host ""

# Test 1: Verify Azure CLI is installed and logged in
Write-Host "Test 1: Checking Azure CLI..." -ForegroundColor Cyan
try {
    $account = az account show 2>$null | ConvertFrom-Json
    if ($account) {
        Write-Host "  ✅ Azure CLI authenticated" -ForegroundColor Green
        Write-Host "     Logged in as: $($account.user.name)" -ForegroundColor Gray
        Write-Host "     Subscription: $($account.name)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️  Not logged into Azure CLI. Run: az login" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Azure CLI not found or not logged in" -ForegroundColor Yellow
}
Write-Host ""

# Test 2: Verify App Registration exists
Write-Host "Test 2: Verifying App Registration exists..." -ForegroundColor Cyan
try {
    $app = az ad app show --id $clientId 2>$null | ConvertFrom-Json
    if ($app) {
        Write-Host "  ✅ App Registration found" -ForegroundColor Green
        Write-Host "     Display Name: $($app.displayName)" -ForegroundColor Gray
        Write-Host "     App ID: $($app.appId)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ App Registration not found with Client ID: $clientId" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ❌ Failed to query App Registration: $_" -ForegroundColor Red
    Write-Host "     Make sure you have permissions to view the app registration" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: Check API Permissions
Write-Host "Test 3: Checking API Permissions..." -ForegroundColor Cyan
try {
    $permissions = az ad app permission list --id $clientId 2>$null | ConvertFrom-Json
    
    $sqlPermission = $permissions | Where-Object { 
        $_.resourceAppId -eq "022907d3-0f1b-48f7-badc-1ba6abab6d66" 
    }
    
    if ($sqlPermission) {
        Write-Host "  ✅ Azure SQL Database permission found" -ForegroundColor Green
        
        $userImpersonation = $sqlPermission.resourceAccess | Where-Object {
            $_.id -eq "c39ef2d1-04ce-46dc-8b5f-e9a5c60f0fc9"
        }
        
        if ($userImpersonation) {
            Write-Host "     ✅ user_impersonation permission configured" -ForegroundColor Green
        } else {
            Write-Host "     ⚠️  user_impersonation permission not found" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠️  Azure SQL Database permission not found" -ForegroundColor Yellow
        Write-Host "     Add permission: Azure SQL Database -> user_impersonation" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Could not check permissions: $_" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "Test 4: Testing token acquisition (OBO flow simulation)..." -ForegroundColor Cyan
Write-Host "  Note: This tests client credentials flow as proxy for OBO" -ForegroundColor Gray

try {
    # Build token request
    $tokenUrl = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = "https://database.windows.net/.default"
        grant_type    = "client_credentials"
    }
    
    $response = Invoke-RestMethod -Method Post -Uri $tokenUrl -Body $body -ContentType "application/x-www-form-urlencoded"
    
    if ($response.access_token) {
        Write-Host "  Token acquired successfully!" -ForegroundColor Green
        Write-Host "     Token Type: $($response.token_type)" -ForegroundColor Gray
        Write-Host "     Expires In: $($response.expires_in) seconds" -ForegroundColor Gray
        Write-Host "     Token Length: $($response.access_token.Length) characters" -ForegroundColor Gray
        
        # Decode JWT to show claims (basic decoding)
        $tokenParts = $response.access_token.Split('.')
        if ($tokenParts.Length -ge 2) {
            $payload = $tokenParts[1]
            # Add padding if needed
            while ($payload.Length % 4 -ne 0) { $payload += "=" }
            $payloadBytes = [Convert]::FromBase64String($payload)
            $payloadJson = [System.Text.Encoding]::UTF8.GetString($payloadBytes) | ConvertFrom-Json
            
            Write-Host ""
            Write-Host "  Token Claims:" -ForegroundColor Cyan
            Write-Host "     Audience: $($payloadJson.aud)" -ForegroundColor Gray
            Write-Host "     Issuer: $($payloadJson.iss)" -ForegroundColor Gray
            Write-Host "     App ID: $($payloadJson.appid)" -ForegroundColor Gray
            if ($payloadJson.exp) {
                $expTime = [DateTimeOffset]::FromUnixTimeSeconds($payloadJson.exp).LocalDateTime
                Write-Host "     Expires: $expTime" -ForegroundColor Gray
            }
        }
    }
} catch {
    $errorDetail = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Token acquisition failed!" -ForegroundColor Red
    Write-Host "     Error: $($errorDetail.error)" -ForegroundColor Red
    Write-Host "     Description: $($errorDetail.error_description)" -ForegroundColor Red
    
    if ($errorDetail.error -eq "invalid_client") {
        Write-Host ""
        Write-Host "  Possible issues:" -ForegroundColor Yellow
        Write-Host "     - Client Secret is incorrect or expired" -ForegroundColor Yellow
        Write-Host "     - Client ID is incorrect" -ForegroundColor Yellow
        Write-Host "     - App Registration has been deleted" -ForegroundColor Yellow
    }
}
Write-Host ""

# Test 5: Verify redirect URIs
Write-Host "Test 5: Checking Redirect URIs..." -ForegroundColor Cyan
try {
    $app = az ad app show --id $clientId 2>$null | ConvertFrom-Json
    
    if ($app.web.redirectUris.Count -gt 0) {
        Write-Host "  ✅ Redirect URIs configured:" -ForegroundColor Green
        foreach ($uri in $app.web.redirectUris) {
            Write-Host "     - $uri" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠️  No redirect URIs configured" -ForegroundColor Yellow
        Write-Host "     Add redirect URI: http://localhost" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Could not check redirect URIs" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "=" * 60
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. If all tests passed, you are ready for Task 1.2!" -ForegroundColor White
Write-Host "2. If token acquisition failed, verify your client secret" -ForegroundColor White
Write-Host "3. If permissions are missing, grant admin consent in Azure Portal" -ForegroundColor White
Write-Host "4. Update RLS_IMPLEMENTATION_PLAN.md - mark Task 1.1 as complete" -ForegroundColor White
Write-Host ""
Write-Host "To test interactive user authentication (OBO flow):" -ForegroundColor Yellow
Write-Host "  Run: .\scripts\test-user-auth.ps1" -ForegroundColor Gray
Write-Host ""

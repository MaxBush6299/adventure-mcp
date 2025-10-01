# Get Azure AD Token for Testing
# This script helps obtain a token for the test user mb6299@MngEnvMCAP095199.onmicrosoft.com

param(
    [string]$TenantId = $env:AZURE_TENANT_ID,
    [string]$ClientId = $env:AZURE_CLIENT_ID,
    [string]$UserEmail = "mb6299@MngEnvMCAP095199.onmicrosoft.com"
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Azure AD Token Acquisition" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

if (-not $TenantId) {
    Write-Host "Error: AZURE_TENANT_ID not set" -ForegroundColor Red
    Write-Host "Please set environment variable or pass -TenantId parameter" -ForegroundColor Yellow
    exit 1
}

if (-not $ClientId) {
    Write-Host "Error: AZURE_CLIENT_ID not set" -ForegroundColor Red
    Write-Host "Please set environment variable or pass -ClientId parameter" -ForegroundColor Yellow
    exit 1
}

Write-Host "Tenant ID: $TenantId"
Write-Host "Client ID: $ClientId"
Write-Host "User: $UserEmail"
Write-Host ""

# Using device code flow for interactive authentication
$tokenEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
$deviceCodeEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode"

# Required scopes for MCP server with SQL access
$scopes = "openid profile offline_access https://database.windows.net/user_impersonation"

Write-Host "Step 1: Requesting device code..." -ForegroundColor Yellow

try {
    # Request device code
    $deviceCodeBody = @{
        client_id = $ClientId
        scope = $scopes
    }
    
    $deviceCodeResponse = Invoke-RestMethod -Method Post -Uri $deviceCodeEndpoint -Body $deviceCodeBody -ContentType "application/x-www-form-urlencoded"
    
    Write-Host "`nStep 2: Please authenticate:" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host $deviceCodeResponse.message -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "`nWaiting for authentication..." -ForegroundColor Yellow
    
    # Poll for token
    $interval = $deviceCodeResponse.interval
    $deviceCode = $deviceCodeResponse.device_code
    $expiresIn = $deviceCodeResponse.expires_in
    $startTime = Get-Date
    
    $tokenBody = @{
        grant_type = "urn:ietf:params:oauth:grant-type:device_code"
        client_id = $ClientId
        device_code = $deviceCode
    }
    
    $token = $null
    
    while ($null -eq $token) {
        Start-Sleep -Seconds $interval
        
        # Check if expired
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        if ($elapsed -gt $expiresIn) {
            Write-Host "`nError: Authentication timeout" -ForegroundColor Red
            exit 1
        }
        
        try {
            $tokenResponse = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $tokenBody -ContentType "application/x-www-form-urlencoded" -ErrorAction Stop
            $token = $tokenResponse.access_token
        } catch {
            $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
            if ($errorDetails.error -eq "authorization_pending") {
                Write-Host "." -NoNewline
            } elseif ($errorDetails.error -eq "slow_down") {
                $interval += 5
            } else {
                Write-Host "`nError: $($errorDetails.error)" -ForegroundColor Red
                Write-Host $errorDetails.error_description -ForegroundColor Yellow
                exit 1
            }
        }
    }
    
    Write-Host "`n`nAuthentication successful!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Cyan
    
    # Parse token to show details
    $tokenParts = $token.Split('.')
    $payload = $tokenParts[1]
    # Add padding if needed
    $padding = 4 - ($payload.Length % 4)
    if ($padding -ne 4) {
        $payload += "=" * $padding
    }
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload)) | ConvertFrom-Json
    
    Write-Host "`nToken Details:"
    Write-Host "  User: $($payloadJson.upn)"
    Write-Host "  Email: $($payloadJson.email)"
    Write-Host "  Name: $($payloadJson.name)"
    Write-Host "  Expires: $(Get-Date -UnixTimeSeconds $payloadJson.exp)"
    Write-Host ""
    
    # Save token to environment variable
    $env:TEST_USER_TOKEN = $token
    Write-Host "Token saved to `$env:TEST_USER_TOKEN" -ForegroundColor Green
    Write-Host ""
    
    # Also save to file for convenience
    $token | Out-File -FilePath "test-user-token.txt" -NoNewline
    Write-Host "Token also saved to: test-user-token.txt" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "You can now run authenticated tests:" -ForegroundColor Yellow
    Write-Host "  .\test\test-task-1.7-authenticated.ps1" -ForegroundColor Cyan
    Write-Host ""
    
} catch {
    Write-Host "`nError obtaining token:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
}

# Get Azure AD Token using Client Credentials + Resource Owner Password Credentials (ROPC)
# Uses client secret from environment variables

param(
    [string]$Username = "mb6299@MngEnvMCAP095199.onmicrosoft.com",
    [string]$Password
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Azure AD Token Acquisition" -ForegroundColor Cyan
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
    Write-Host "Error: Missing Azure credentials" -ForegroundColor Red
    Write-Host "Please ensure these are set in .env file:" -ForegroundColor Yellow
    Write-Host "  AZURE_TENANT_ID" -ForegroundColor Yellow
    Write-Host "  AZURE_CLIENT_ID" -ForegroundColor Yellow
    Write-Host "  AZURE_CLIENT_SECRET" -ForegroundColor Yellow
    exit 1
}

Write-Host "Tenant ID: $tenantId"
Write-Host "Client ID: $clientId"
Write-Host "Username: $Username"
Write-Host ""

# If password not provided, prompt for it
if (-not $Password) {
    Write-Host "Please enter password for $Username" -ForegroundColor Yellow
    $securePassword = Read-Host -AsSecureString "Password"
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

# Token endpoint
$tokenEndpoint = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"

# Required scopes
$scopes = "https://database.windows.net/.default"

Write-Host "Requesting token using Resource Owner Password Credentials (ROPC)..." -ForegroundColor Yellow

try {
    # Request token using ROPC flow
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = $scopes
        username      = $Username
        password      = $Password
        grant_type    = "password"
    }
    
    $response = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType "application/x-www-form-urlencoded"
    
    $token = $response.access_token
    
    Write-Host "`nAuthentication successful!" -ForegroundColor Green
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
    if ($payloadJson.upn) {
        Write-Host "  User: $($payloadJson.upn)"
    }
    if ($payloadJson.unique_name) {
        Write-Host "  User: $($payloadJson.unique_name)"
    }
    if ($payloadJson.email) {
        Write-Host "  Email: $($payloadJson.email)"
    }
    if ($payloadJson.name) {
        Write-Host "  Name: $($payloadJson.name)"
    }
    Write-Host "  Expires: $(Get-Date -UnixTimeSeconds $payloadJson.exp)"
    Write-Host "  Token Length: $($token.Length) characters"
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
    Write-Host "  `$env:TEST_USER_TOKEN = Get-Content test-user-token.txt" -ForegroundColor Cyan
    Write-Host "  .\test\test-task-1.7-authenticated.ps1" -ForegroundColor Cyan
    Write-Host ""
    
    return $token
    
} catch {
    Write-Host "`nError obtaining token:" -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        try {
            $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
            Write-Host "  Error: $($errorJson.error)" -ForegroundColor Yellow
            Write-Host "  Description: $($errorJson.error_description)" -ForegroundColor Yellow
            
            if ($errorJson.error -eq "invalid_grant") {
                Write-Host "`nPossible causes:" -ForegroundColor Yellow
                Write-Host "  - Incorrect username or password" -ForegroundColor Gray
                Write-Host "  - Account requires MFA (ROPC doesn't support MFA)" -ForegroundColor Gray
                Write-Host "  - Account is disabled or locked" -ForegroundColor Gray
                Write-Host "  - Password expired" -ForegroundColor Gray
            }
            
            if ($errorJson.error -eq "unauthorized_client") {
                Write-Host "`nThe app registration needs ROPC enabled:" -ForegroundColor Yellow
                Write-Host "  1. Go to Azure Portal > App Registrations" -ForegroundColor Gray
                Write-Host "  2. Select your app: $clientId" -ForegroundColor Gray
                Write-Host "  3. Go to Authentication" -ForegroundColor Gray
                Write-Host "  4. Under 'Advanced settings' > 'Allow public client flows' > Enable" -ForegroundColor Gray
            }
        } catch {
            Write-Host $_.Exception.Message -ForegroundColor Yellow
        }
    } else {
        Write-Host $_.Exception.Message -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Alternative: Use Azure CLI authentication:" -ForegroundColor Yellow
    Write-Host "  .\test\get-auth-token-cli.ps1" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

AADSTS70011: The provided request must include a 'scope' input parameter. The provided value for the input parameter 'scope' is not valid. The scope https://database.windows.net/ openid profile offline_access is not valid. The scope format is invalid. Scope must be in a valid URI form <https://example/scope> or a valid Guid <guid/scope>.# Get Azure AD Token using Azure CLI
# This is simpler and uses your existing Azure CLI authentication

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Azure AD Token via Azure CLI" -ForegroundColor Cyan
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

$clientId = $env:AZURE_CLIENT_ID
if (-not $clientId) {
    Write-Host "Error: AZURE_CLIENT_ID not found in .env file" -ForegroundColor Red
    exit 1
}

Write-Host "Client ID: $clientId" -ForegroundColor Green
Write-Host ""

# Check if Azure CLI is installed
try {
    $azVersion = az version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI not found"
    }
} catch {
    Write-Host "Error: Azure CLI is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Yellow
    exit 1
}

Write-Host "Azure CLI found" -ForegroundColor Green

# Login check
Write-Host "Checking Azure CLI login status..." -ForegroundColor Yellow
try {
    $account = az account show 2>$null | ConvertFrom-Json
    Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Green
} catch {
    Write-Host "Not logged in to Azure CLI" -ForegroundColor Yellow
    Write-Host "Running: az login..." -ForegroundColor Yellow
    az login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Azure CLI login failed" -ForegroundColor Red
        exit 1
    }
}

# Get token for Azure SQL Database (for testing)
# The server now accepts both our client ID and SQL Database tokens
Write-Host "`nGetting token for Azure SQL Database..." -ForegroundColor Yellow
Write-Host "Resource: https://database.windows.net/" -ForegroundColor Gray
try {
    $token = az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv
    
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($token)) {
        throw "Failed to get token"
    }
    
    Write-Host "Token acquired successfully!" -ForegroundColor Green
    Write-Host ""
    
    # Parse token to show details
    $tokenParts = $token.Split('.')
    $payload = $tokenParts[1]
    # Add padding if needed
    $padding = 4 - ($payload.Length % 4)
    if ($padding -ne 4) {
        $payload += "=" * $padding
    }
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload)) | ConvertFrom-Json
    
    Write-Host "Token Details:"
    Write-Host "  User: $($payloadJson.upn)"
    if ($payloadJson.email) {
        Write-Host "  Email: $($payloadJson.email)"
    }
    if ($payloadJson.name) {
        Write-Host "  Name: $($payloadJson.name)"
    }
    # Convert Unix timestamp to DateTime (compatible with older PowerShell)
    $expiryDate = (Get-Date "1970-01-01 00:00:00").AddSeconds($payloadJson.exp)
    Write-Host "  Expires: $expiryDate"
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
    Write-Host ""
    Write-Host "Make sure you're logged in with: az login" -ForegroundColor Yellow
    exit 1
}

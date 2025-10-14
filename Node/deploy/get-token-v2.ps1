# Get v2.0 Token (with /.default scope)
# This will get a token with v2.0 format which might work better with APIM

$clientId = "17a97781-0078-4478-8b4e-fe5dda9e2400"
$tenantId = "2e9b0657-eef8-47af-8747-5e89476faaab"
$redirectUri = "http://localhost:8888/callback"
$scope = "api://17a97781-0078-4478-8b4e-fe5dda9e2400/.default"  # Note: /.default added

# Authorization URL
$authUrl = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/authorize?" +
    "client_id=$clientId" +
    "&response_type=code" +
    "&redirect_uri=$([uri]::EscapeDataString($redirectUri))" +
    "&response_mode=query" +
    "&scope=$([uri]::EscapeDataString($scope))"

Write-Host "Opening browser for authentication..." -ForegroundColor Yellow
Write-Host "Authorize URL: $authUrl`n" -ForegroundColor Gray
Start-Process $authUrl

# Rest of the script is the same as get-user-token.ps1
# (Not including here to keep it short - you already have the working script)

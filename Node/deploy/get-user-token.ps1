# Get User Token with Authorization Code Flow
# This script gets a proper user token with delegated permissions

Write-Host "`n🔐 Getting User Token with Delegated Permissions" -ForegroundColor Cyan
Write-Host "==================================================`n" -ForegroundColor Cyan

# Configuration
$tenantId = "2e9b0657-eef8-47af-8747-5e89476faaab"
$clientId = "17a97781-0078-4478-8b4e-fe5dda9e2400"
$clientSecret = $env:AZURE_CLIENT_SECRET  # Read from environment variable
if (-not $clientSecret) {
    Write-Host "ERROR: AZURE_CLIENT_SECRET environment variable not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:AZURE_CLIENT_SECRET = 'your-secret-here'" -ForegroundColor Yellow
    exit 1
}
$scope = "api://17a97781-0078-4478-8b4e-fe5dda9e2400/user_impersonation"
$redirectUri = "http://localhost:8888/callback"

# Start a local HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("$redirectUri/")
$listener.Start()

Write-Host "✓ Local callback server started on port 8888" -ForegroundColor Green

# Generate the authorization URL
$authUrl = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/authorize?" + 
    "client_id=$clientId&" +
    "response_type=code&" +
    "redirect_uri=$redirectUri&" +
    "response_mode=query&" +
    "scope=$scope&" +
    "state=12345"

Write-Host "`n📱 Opening browser for authentication..." -ForegroundColor Yellow
Write-Host "   URL: $authUrl" -ForegroundColor Gray
Start-Process $authUrl

Write-Host "`n⏳ Waiting for you to sign in..." -ForegroundColor Cyan
Write-Host "   After signing in, the browser will redirect back automatically." -ForegroundColor White

# Wait for the callback
$context = $listener.GetContext()
$request = $context.Request
$response = $context.Response

# Extract the authorization code
$code = $request.QueryString["code"]
$authError = $request.QueryString["error"]

# Send response to browser
$responseString = if ($code) {
    "<html><body><h1>✅ Authentication Successful!</h1><p>You can close this window and return to PowerShell.</p></body></html>"
} else {
    "<html><body><h1>❌ Authentication Failed</h1><p>Error: $authError</p></body></html>"
}

$buffer = [System.Text.Encoding]::UTF8.GetBytes($responseString)
$response.ContentLength64 = $buffer.Length
$response.OutputStream.Write($buffer, 0, $buffer.Length)
$response.OutputStream.Close()
$listener.Stop()

if ($code) {
    Write-Host "`n✅ Authorization code received!" -ForegroundColor Green
    Write-Host "   Exchanging code for token..." -ForegroundColor Yellow
    
    # Exchange code for token
    $tokenBody = @{
        grant_type = "authorization_code"
        client_id = $clientId
        client_secret = $clientSecret
        code = $code
        redirect_uri = $redirectUri
        scope = $scope
    }
    
    try {
        $tokenResponse = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Method POST -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
        
        $accessToken = $tokenResponse.access_token
        
        Write-Host "✅ Access token acquired!" -ForegroundColor Green
        
        # Decode and display token claims
        Write-Host "`n📋 Token Claims:" -ForegroundColor Cyan
        $tokenParts = $accessToken.Split('.')
        $payload = $tokenParts[1]
        $paddedPayload = $payload + ('=' * ((4 - ($payload.Length % 4)) % 4))
        $decodedBytes = [System.Convert]::FromBase64String($paddedPayload)
        $decodedJson = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
        $claims = $decodedJson | ConvertFrom-Json
        
        Write-Host "   Audience (aud): $($claims.aud)" -ForegroundColor White
        Write-Host "   User (upn): $($claims.upn)" -ForegroundColor White
        Write-Host "   Scopes (scp): $($claims.scp)" -ForegroundColor Green
        Write-Host "   App ID (appid): $($claims.appid)" -ForegroundColor White
        
        # Save token to global variable
        $global:userToken = $accessToken
        
        Write-Host "`n✅ Token saved to `$global:userToken" -ForegroundColor Green
        Write-Host "`nYou can now use this token to test the API:" -ForegroundColor Cyan
        Write-Host '   $headers = @{ "Authorization" = "Bearer $global:userToken"; "Content-Type" = "application/json" }' -ForegroundColor Gray
        Write-Host '   Invoke-RestMethod -Uri "https://mssqlmcp.azure-api.net/mcp" -Method POST -Headers $headers -Body $body' -ForegroundColor Gray
        
    } catch {
        Write-Host "❌ Failed to exchange code for token" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "   Response: $responseBody" -ForegroundColor Red
        }
    }
    
} else {
    Write-Host "`n❌ Authentication failed: $authError" -ForegroundColor Red
    Write-Host "   Description: $($request.QueryString['error_description'])" -ForegroundColor Red
}

# Test script to verify anonymous tool discovery works
# while tool execution requires authentication

param(
    [string]$ServerUrl = "http://localhost:8080"
)

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Testing MCP Tool Discovery (Anonymous)       " -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "Server: $ServerUrl`n" -ForegroundColor Yellow

# Test 1: Health check (should work without auth)
Write-Host "[1/6] Testing health endpoint (no auth)..." -ForegroundColor Cyan
try {
    $healthResponse = Invoke-RestMethod -Method Get -Uri "$ServerUrl/health"
    Write-Host "✅ Health check: $($healthResponse.status)" -ForegroundColor Green
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: GET /mcp (should work without auth)
Write-Host "`n[2/6] Testing GET /mcp (no auth)..." -ForegroundColor Cyan
try {
    $mcpInfo = Invoke-RestMethod -Method Get -Uri "$ServerUrl/mcp"
    Write-Host "✅ Server info retrieved: $($mcpInfo.server.name)" -ForegroundColor Green
    Write-Host "   Tools available: $($mcpInfo.tools.Count)" -ForegroundColor White
} catch {
    Write-Host "❌ GET /mcp failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: GET /mcp/tools (should work without auth)
Write-Host "`n[3/6] Testing GET /mcp/tools (no auth)..." -ForegroundColor Cyan
try {
    $toolsResponse = Invoke-RestMethod -Method Get -Uri "$ServerUrl/mcp/tools"
    Write-Host "✅ Tools list retrieved: $($toolsResponse.tools.Count) tools" -ForegroundColor Green
    $toolsResponse.tools | ForEach-Object {
        Write-Host "   - $($_.name): $($_.description)" -ForegroundColor White
    }
} catch {
    Write-Host "❌ GET /mcp/tools failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: GET /mcp/introspect (should work without auth)
Write-Host "`n[4/6] Testing GET /mcp/introspect (no auth)..." -ForegroundColor Cyan
try {
    $introspect = Invoke-RestMethod -Method Get -Uri "$ServerUrl/mcp/introspect"
    Write-Host "✅ Introspection retrieved" -ForegroundColor Green
    Write-Host "   Server: $($introspect.server.name) v$($introspect.server.version)" -ForegroundColor White
    Write-Host "   Endpoints documented: $($introspect.endpoints.Count)" -ForegroundColor White
    
    # Show authentication requirements
    Write-Host "`n   Authentication Requirements:" -ForegroundColor Yellow
    $introspect.endpoints | Where-Object { $_.authentication } | ForEach-Object {
        $authColor = if ($_.authentication -eq "none") { "Green" } elseif ($_.authentication -like "*required*") { "Red" } else { "Yellow" }
        Write-Host "   $($_.method.PadRight(6)) $($_.path.PadRight(25)) - $($_.authentication)" -ForegroundColor $authColor
    }
} catch {
    Write-Host "❌ GET /mcp/introspect failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: POST /mcp with tools/list (should work without auth)
Write-Host "`n[5/6] Testing POST /mcp with tools/list (no auth)..." -ForegroundColor Cyan
$toolsListRequest = @{
    jsonrpc = "2.0"
    id = 1
    method = "tools/list"
    params = @{}
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Method Post -Uri "$ServerUrl/mcp" -Body $toolsListRequest -ContentType "application/json"
    Write-Host "✅ tools/list via JSON-RPC succeeded" -ForegroundColor Green
    Write-Host "   Tools: $($response.result.tools.Count)" -ForegroundColor White
} catch {
    Write-Host "❌ tools/list via JSON-RPC failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: POST /mcp with tools/call (should FAIL without auth if REQUIRE_AUTH=true)
Write-Host "`n[6/6] Testing POST /mcp with tools/call (no auth - should fail)..." -ForegroundColor Cyan
$toolsCallRequest = @{
    jsonrpc = "2.0"
    id = 2
    method = "tools/call"
    params = @{
        name = "list_tables"
        arguments = @{}
    }
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Method Post -Uri "$ServerUrl/mcp" -Body $toolsCallRequest -ContentType "application/json"
    Write-Host "⚠️  tools/call succeeded without auth (REQUIRE_AUTH may be false)" -ForegroundColor Yellow
    Write-Host "   Response: $($response.result | ConvertTo-Json -Compress)" -ForegroundColor White
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Host "✅ tools/call correctly rejected (401 Unauthorized)" -ForegroundColor Green
        Write-Host "   This is expected when REQUIRE_AUTH=true" -ForegroundColor White
    } else {
        Write-Host "❌ tools/call failed with unexpected error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Test Complete!" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "  ✅ Tool discovery endpoints should work without authentication" -ForegroundColor Green
Write-Host "  ✅ Tool execution should require authentication (if REQUIRE_AUTH=true)" -ForegroundColor Green
Write-Host "`nThis follows the MCP standard pattern.`n" -ForegroundColor White

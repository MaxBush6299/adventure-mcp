# Task 1.7 Simple Integration Test
# Tests MCP tools with ToolContext using PowerShell

$SERVER = "http://localhost:8080"
$ErrorActionPreference = "Continue"

Write-Host "`n========================================"
Write-Host "Task 1.7: MCP Tools Integration Test"
Write-Host "========================================"
Write-Host "Server: $SERVER`n"

$passed = 0
$failed = 0
$total = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method = "GET",
        [string]$Path,
        [object]$Body = $null,
        [string]$Token = $null
    )
    
    $script:total++
    Write-Host "Test $($script:total): $Name" -NoNewline
    
    try {
        $headers = @{
            "Content-Type" = "application/json"
        }
        
        if ($Token) {
            $headers["Authorization"] = "Bearer $Token"
        }
        
        $params = @{
            Uri = "$SERVER$Path"
            Method = $Method
            Headers = $headers
            UseBasicParsing = $true
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-WebRequest @params
        
        if ($response.StatusCode -eq 200) {
            Write-Host " [PASS]" -ForegroundColor Green
            $script:passed++
            return $response.Content | ConvertFrom-Json
        } else {
            Write-Host " [FAIL] (Status: $($response.StatusCode))" -ForegroundColor Red
            $script:failed++
            return $null
        }
    } catch {
        Write-Host " [FAIL]" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
        return $null
    }
}

# Test 1: Health Check
$result = Test-Endpoint -Name "Health Check" -Path "/health"
if ($result) {
    Write-Host "  Status: $($result.status)" -ForegroundColor Cyan
}

# Test 2: List Tools
$result = Test-Endpoint -Name "List Tools" -Path "/mcp/tools"
if ($result -and $result.tools) {
    Write-Host "  Tools found: $($result.tools.Count)" -ForegroundColor Cyan
}

# Test 3: Call tool without auth (backward compatibility)
$readRequest = @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "read_data"
        arguments = @{
            query = "SELECT TOP 5 * FROM Security.Documents"
        }
    }
    id = 1
}

$result = Test-Endpoint -Name "ReadData without auth" -Method "POST" -Path "/mcp" -Body $readRequest
if ($result -and $result.result) {
    $content = $result.result.content[0].text | ConvertFrom-Json
    Write-Host "  Success: $($content.success), Rows: $($content.rows.Count)" -ForegroundColor Cyan
    
    if ($content.rows.Count -eq 0) {
        Write-Host "  RLS working: dbo sees 0 rows [OK]" -ForegroundColor Green
    }
}

# Test 4: List Tables
$listRequest = @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "list_table"
        arguments = @{
            parameters = @("Security")
        }
    }
    id = 2
}

$result = Test-Endpoint -Name "List Tables (Security schema)" -Method "POST" -Path "/mcp" -Body $listRequest
if ($result -and $result.result) {
    $content = $result.result.content[0].text | ConvertFrom-Json
    Write-Host "  Success: $($content.success), Tables: $($content.items.Count)" -ForegroundColor Cyan
}

# Test 5: Describe Table
$describeRequest = @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "describe_table"
        arguments = @{
            tableName = "Documents"
        }
    }
    id = 3
}

$result = Test-Endpoint -Name "Describe Table (Documents)" -Method "POST" -Path "/mcp" -Body $describeRequest
if ($result -and $result.result) {
    $content = $result.result.content[0].text | ConvertFrom-Json
    Write-Host "  Success: $($content.success), Columns: $($content.columns.Count)" -ForegroundColor Cyan
}

# Summary
Write-Host ""
Write-Host "========================================"
Write-Host "Test Summary"
Write-Host "========================================"
Write-Host "Total:  $total"
Write-Host "Passed: $passed [PASS]" -ForegroundColor Green
Write-Host "Failed: $failed [FAIL]" -ForegroundColor Red
Write-Host "========================================"

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "All tests passed!" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host ""
    Write-Host "Some tests failed" -ForegroundColor Red
    Write-Host ""
    exit 1
}

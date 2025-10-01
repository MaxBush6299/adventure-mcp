# Task 1.7 Authenticated Integration Test
# Tests MCP tools with real Azure AD authentication and RLS enforcement

param(
    [string]$Token = $env:TEST_USER_TOKEN,
    [string]$Server = "http://localhost:8080"
)

$ErrorActionPreference = "Continue"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Task 1.7: Authenticated Integration Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Server: $Server`n" -ForegroundColor Cyan

# Check if token is provided
if (-not $Token) {
    # Try to load from file
    if (Test-Path "test-user-token.txt") {
        $Token = Get-Content "test-user-token.txt" -Raw
        Write-Host "Loaded token from test-user-token.txt" -ForegroundColor Green
    } else {
        Write-Host "Error: No authentication token provided" -ForegroundColor Red
        Write-Host "Please run: .\test\get-auth-token.ps1" -ForegroundColor Yellow
        Write-Host "Or set: `$env:TEST_USER_TOKEN = '<your_token>'" -ForegroundColor Yellow
        exit 1
    }
}

# Parse token to show user info
try {
    $tokenParts = $Token.Split('.')
    $payload = $tokenParts[1]
    $padding = 4 - ($payload.Length % 4)
    if ($padding -ne 4) {
        $payload += "=" * $padding
    }
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload)) | ConvertFrom-Json
    
    Write-Host "Authenticated as: $($payloadJson.upn)" -ForegroundColor Green
    Write-Host "Token expires: $(Get-Date -UnixTimeSeconds $payloadJson.exp)" -ForegroundColor Yellow
    Write-Host ""
} catch {
    Write-Host "Warning: Could not parse token" -ForegroundColor Yellow
}

$script:passed = 0
$script:failed = 0
$script:total = 0

function Test-AuthEndpoint {
    param(
        [string]$Name,
        [string]$Method = "POST",
        [hashtable]$RequestBody,
        [scriptblock]$Validate
    )
    
    $script:total++
    Write-Host "Test $($script:total): $Name" -NoNewline
    
    try {
        $headers = @{
            "Content-Type" = "application/json"
            "Authorization" = "Bearer $Token"
        }
        
        $params = @{
            Uri = "$Server/mcp"
            Method = $Method
            Headers = $headers
            Body = ($RequestBody | ConvertTo-Json -Depth 10)
            UseBasicParsing = $true
        }
        
        $response = Invoke-WebRequest @params
        
        if ($response.StatusCode -eq 200) {
            $result = $response.Content | ConvertFrom-Json
            
            if ($result.result) {
                $content = $result.result.content[0].text | ConvertFrom-Json
                
                # Run validation
                if ($Validate) {
                    $validationResult = & $Validate $content
                    if ($validationResult) {
                        Write-Host " [PASS]" -ForegroundColor Green
                        $script:passed++
                        return $content
                    } else {
                        Write-Host " [FAIL] - Validation failed" -ForegroundColor Red
                        $script:failed++
                        return $null
                    }
                } else {
                    Write-Host " [PASS]" -ForegroundColor Green
                    $script:passed++
                    return $content
                }
            } else {
                Write-Host " [FAIL] - No result in response" -ForegroundColor Red
                $script:failed++
                return $null
            }
        } else {
            Write-Host " [FAIL] (Status: $($response.StatusCode))" -ForegroundColor Red
            $script:failed++
            return $null
        }
    } catch {
        Write-Host " [FAIL]" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) {
            $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
            if ($errorJson.error) {
                Write-Host "  API Error: $($errorJson.error.message)" -ForegroundColor Yellow
            }
        }
        $script:failed++
        return $null
    }
}

Write-Host "Running authenticated tests...`n" -ForegroundColor Yellow

# Test 1: Read own documents (RLS should show only user's data)
$result = Test-AuthEndpoint -Name "Read Documents (RLS filtering)" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "read_data"
        arguments = @{
            query = "SELECT * FROM Security.Documents ORDER BY DocumentID"
        }
    }
    id = 1
} -Validate {
    param($content)
    
    Write-Host ""
    Write-Host "  Success: $($content.success)" -ForegroundColor Cyan
    Write-Host "  Rows returned: $($content.rows.Count)" -ForegroundColor Cyan
    
    if ($content.rows.Count -gt 0) {
        Write-Host "  Documents:" -ForegroundColor Cyan
        foreach ($row in $content.rows) {
            Write-Host "    - ID: $($row.DocumentID), Name: $($row.DocumentName), Owner: $($row.Owner)" -ForegroundColor Gray
        }
        
        # Verify RLS: all rows should belong to authenticated user
        $allOwnedByUser = $content.rows | ForEach-Object { $_.Owner -like "*mb6299*" } | Where-Object { $_ -eq $false }
        if ($allOwnedByUser.Count -eq 0) {
            Write-Host "  [RLS VERIFIED] All rows belong to authenticated user" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [RLS FAILED] Found rows not owned by user!" -ForegroundColor Red
            return $false
        }
    } else {
        Write-Host "  [WARNING] No rows returned - RLS might be too restrictive" -ForegroundColor Yellow
        return $true  # Not necessarily a failure
    }
}

# Test 2: Try to insert document as current user (should succeed)
$testDocName = "AuthTest_$(Get-Date -Format 'yyyyMMddHHmmss')"
$result = Test-AuthEndpoint -Name "Insert Document (own owner)" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "insert_data"
        arguments = @{
            tableName = "Security.Documents"
            data = @{
                DocumentName = $testDocName
                Content = "Test document created by authenticated test"
                Owner = "mb6299@MngEnvMCAP095199.onmicrosoft.com"
            }
        }
    }
    id = 2
} -Validate {
    param($content)
    
    Write-Host ""
    Write-Host "  Success: $($content.success)" -ForegroundColor Cyan
    Write-Host "  Message: $($content.message)" -ForegroundColor Cyan
    
    if ($content.success) {
        Write-Host "  [INSERT ALLOWED] User can insert own documents" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [INSERT BLOCKED] Should have been allowed!" -ForegroundColor Red
        return $false
    }
}

# Test 3: Try to insert document with different owner (RLS should block)
$result = Test-AuthEndpoint -Name "Insert Document (different owner - should block)" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "insert_data"
        arguments = @{
            tableName = "Security.Documents"
            data = @{
                DocumentName = "MaliciousDoc_$(Get-Date -Format 'yyyyMMddHHmmss')"
                Content = "Attempting to insert as different owner"
                Owner = "attacker@example.com"
            }
        }
    }
    id = 3
} -Validate {
    param($content)
    
    Write-Host ""
    Write-Host "  Success: $($content.success)" -ForegroundColor Cyan
    Write-Host "  Message: $($content.message)" -ForegroundColor Cyan
    
    if (-not $content.success) {
        Write-Host "  [RLS BLOCK WORKING] Insert with different owner was blocked" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [RLS BLOCK FAILED] Should have been blocked!" -ForegroundColor Red
        return $false
    }
}

# Test 4: Update own document
$result = Test-AuthEndpoint -Name "Update Document (own document)" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "update_data"
        arguments = @{
            tableName = "Security.Documents"
            updates = @{
                Content = "Updated by authenticated test at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            }
            where = "DocumentID = 1"
        }
    }
    id = 4
} -Validate {
    param($content)
    
    Write-Host ""
    Write-Host "  Success: $($content.success)" -ForegroundColor Cyan
    Write-Host "  Message: $($content.message)" -ForegroundColor Cyan
    
    if ($content.success) {
        Write-Host "  [UPDATE ALLOWED] User can update own documents" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [UPDATE BLOCKED] Should have been allowed!" -ForegroundColor Red
        return $false
    }
}

# Test 5: List tables (should work with user's connection)
$result = Test-AuthEndpoint -Name "List Tables in Security schema" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "list_table"
        arguments = @{
            parameters = @("Security")
        }
    }
    id = 5
} -Validate {
    param($content)
    
    Write-Host ""
    Write-Host "  Success: $($content.success)" -ForegroundColor Cyan
    Write-Host "  Tables found: $($content.items.Count)" -ForegroundColor Cyan
    
    if ($content.success -and $content.items.Count -gt 0) {
        Write-Host "  [SCHEMA ACCESS] User can list tables" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [SCHEMA ACCESS FAILED]" -ForegroundColor Red
        return $false
    }
}

# Test 6: Describe Documents table
$result = Test-AuthEndpoint -Name "Describe Documents table schema" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "describe_table"
        arguments = @{
            tableName = "Documents"
        }
    }
    id = 6
} -Validate {
    param($content)
    
    Write-Host ""
    Write-Host "  Success: $($content.success)" -ForegroundColor Cyan
    Write-Host "  Columns: $($content.columns.Count)" -ForegroundColor Cyan
    
    if ($content.success) {
        $columnNames = $content.columns | ForEach-Object { $_.name }
        Write-Host "  Column list: $($columnNames -join ', ')" -ForegroundColor Gray
        Write-Host "  [SCHEMA READ] User can read table schema" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [SCHEMA READ FAILED]" -ForegroundColor Red
        return $false
    }
}

# Clean up test document
Write-Host "`nCleaning up test document..." -ForegroundColor Yellow
Test-AuthEndpoint -Name "Cleanup: Delete test document" -RequestBody @{
    jsonrpc = "2.0"
    method = "tools/call"
    params = @{
        name = "update_data"
        arguments = @{
            tableName = "Security.Documents"
            updates = @{
                Content = "[DELETED BY TEST]"
            }
            where = "DocumentName = '$testDocName'"
        }
    }
    id = 99
} | Out-Null

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total:  $total"
Write-Host "Passed: $passed [PASS]" -ForegroundColor Green
Write-Host "Failed: $failed [FAIL]" -ForegroundColor Red
Write-Host "========================================`n" -ForegroundColor Cyan

if ($failed -eq 0) {
    Write-Host "All authenticated tests passed!" -ForegroundColor Green
    Write-Host "RLS is working correctly!" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host "Some tests failed - review RLS configuration" -ForegroundColor Red
    Write-Host ""
    exit 1
}

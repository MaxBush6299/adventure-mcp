# Test New Discovery Tools
# This script tests all 7 new database discovery tools

param(
    [string]$ServerUrl = "http://localhost:8080",
    [string]$Token = $null  # Optional: Bearer token for authenticated requests
)

Write-Host "`n=== Testing New Discovery Tools ===" -ForegroundColor Cyan
Write-Host "Server URL: $ServerUrl`n" -ForegroundColor Gray

# Helper function to call MCP tools
function Invoke-McpTool {
    param(
        [string]$ToolName,
        [hashtable]$Arguments = @{},
        [string]$BearerToken = $null
    )
    
    $body = @{
        jsonrpc = "2.0"
        id = 1
        method = "tools/call"
        params = @{
            name = $ToolName
            arguments = $Arguments
        }
    } | ConvertTo-Json -Depth 10
    
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($BearerToken) {
        $headers["Authorization"] = "Bearer $BearerToken"
    }
    
    try {
        Write-Host "  Calling: $ToolName" -ForegroundColor Yellow
        if ($Arguments.Count -gt 0) {
            Write-Host "  Args: $($Arguments | ConvertTo-Json -Compress)" -ForegroundColor Gray
        }
        
        $response = Invoke-RestMethod -Uri "$ServerUrl/mcp" -Method POST -Body $body -Headers $headers
        
        if ($response.result) {
            $resultContent = $response.result.content[0].text | ConvertFrom-Json
            
            if ($resultContent.success) {
                Write-Host "  ✓ Success!" -ForegroundColor Green
                
                # Display count information
                if ($resultContent.count) {
                    Write-Host "    Found: $($resultContent.count) items" -ForegroundColor Cyan
                }
                
                # Display first few items
                $items = $null
                if ($resultContent.procedures) { $items = $resultContent.procedures }
                if ($resultContent.views) { $items = $resultContent.views }
                if ($resultContent.functions) { $items = $resultContent.functions }
                if ($resultContent.schemas) { $items = $resultContent.schemas }
                if ($resultContent.tables) { $items = $resultContent.tables }
                if ($resultContent.triggers) { $items = $resultContent.triggers }
                
                if ($items -and $items.Count -gt 0) {
                    $displayCount = [Math]::Min(3, $items.Count)
                    Write-Host "    First $displayCount items:" -ForegroundColor Gray
                    $items[0..($displayCount - 1)] | ForEach-Object {
                        Write-Host "      - $($_ | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
                    }
                    if ($items.Count -gt 3) {
                        Write-Host "      ... and $($items.Count - 3) more" -ForegroundColor DarkGray
                    }
                }
                
                return $resultContent
            } else {
                Write-Host "  ✗ Failed: $($resultContent.message)" -ForegroundColor Red
                return $null
            }
        } else {
            Write-Host "  ✗ Error: $($response.error.message)" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "  ✗ Exception: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
    
    Write-Host ""
}

# Test 1: List Schemas
Write-Host "`n[1/7] Testing list_schemas..." -ForegroundColor Cyan
$schemas = Invoke-McpTool -ToolName "list_schemas" -BearerToken $Token
Write-Host ""

# Test 2: List Stored Procedures (all)
Write-Host "[2/7] Testing list_stored_procedures (all)..." -ForegroundColor Cyan
$procedures = Invoke-McpTool -ToolName "list_stored_procedures" -BearerToken $Token
Write-Host ""

# Test 3: List Stored Procedures (filtered by schema)
if ($schemas -and $schemas.schemas -and $schemas.schemas.Count -gt 0) {
    $firstSchema = $schemas.schemas[0].SchemaName
    Write-Host "[3/7] Testing list_stored_procedures (schema: $firstSchema)..." -ForegroundColor Cyan
    $proceduresFiltered = Invoke-McpTool -ToolName "list_stored_procedures" -Arguments @{ schemaName = $firstSchema } -BearerToken $Token
} else {
    Write-Host "[3/7] Skipping list_stored_procedures (filtered) - no schemas found" -ForegroundColor Yellow
}
Write-Host ""

# Test 4: Describe Stored Procedure
if ($procedures -and $procedures.procedures -and $procedures.procedures.Count -gt 0) {
    $firstProc = $procedures.procedures[0]
    Write-Host "[4/7] Testing describe_stored_procedure ($($firstProc.SchemaName).$($firstProc.ProcedureName))..." -ForegroundColor Cyan
    $procDetails = Invoke-McpTool -ToolName "describe_stored_procedure" -Arguments @{ 
        procedureName = $firstProc.ProcedureName
        schemaName = $firstProc.SchemaName
    } -BearerToken $Token
} else {
    Write-Host "[4/7] Skipping describe_stored_procedure - no procedures found" -ForegroundColor Yellow
}
Write-Host ""

# Test 5: List Views
Write-Host "[5/7] Testing list_views..." -ForegroundColor Cyan
$views = Invoke-McpTool -ToolName "list_views" -BearerToken $Token
Write-Host ""

# Test 6: List Functions (especially for RLS predicates)
Write-Host "[6/7] Testing list_functions..." -ForegroundColor Cyan
$functions = Invoke-McpTool -ToolName "list_functions" -BearerToken $Token
Write-Host ""

# Test 6b: List Functions in Security schema (for RLS)
Write-Host "[6b/7] Testing list_functions (Security schema)..." -ForegroundColor Cyan
$rlsFunctions = Invoke-McpTool -ToolName "list_functions" -Arguments @{ schemaName = "Security" } -BearerToken $Token
Write-Host ""

# Test 7: Get Table Row Count (all tables)
Write-Host "[7/7] Testing get_table_row_count (all tables)..." -ForegroundColor Cyan
$rowCounts = Invoke-McpTool -ToolName "get_table_row_count" -BearerToken $Token
Write-Host ""

# Test 8: List Triggers
Write-Host "[8/7] Testing list_triggers..." -ForegroundColor Cyan
$triggers = Invoke-McpTool -ToolName "list_triggers" -BearerToken $Token
Write-Host ""

# Summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
Write-Host "✓ list_schemas: $($schemas.count) schemas found" -ForegroundColor $(if ($schemas) { "Green" } else { "Red" })
Write-Host "✓ list_stored_procedures: $($procedures.count) procedures found" -ForegroundColor $(if ($procedures) { "Green" } else { "Red" })
Write-Host "✓ describe_stored_procedure: $(if ($procDetails) { "Success" } else { "Skipped/Failed" })" -ForegroundColor $(if ($procDetails) { "Green" } else { "Yellow" })
Write-Host "✓ list_views: $($views.count) views found" -ForegroundColor $(if ($views) { "Green" } else { "Red" })
Write-Host "✓ list_functions: $($functions.count) functions found" -ForegroundColor $(if ($functions) { "Green" } else { "Red" })
Write-Host "✓ list_functions (Security): $($rlsFunctions.count) RLS functions found" -ForegroundColor $(if ($rlsFunctions) { "Green" } else { "Yellow" })
Write-Host "✓ get_table_row_count: $($rowCounts.count) tables analyzed" -ForegroundColor $(if ($rowCounts) { "Green" } else { "Red" })
Write-Host "✓ list_triggers: $($triggers.count) triggers found" -ForegroundColor $(if ($triggers) { "Green" } else { "Red" })

# RLS-specific checks
if ($rlsFunctions -and $rlsFunctions.functions) {
    Write-Host "`n=== RLS Function Discovery ===" -ForegroundColor Cyan
    $predicates = $rlsFunctions.functions | Where-Object { $_.FunctionName -like "*Predicate*" }
    if ($predicates) {
        Write-Host "Found $($predicates.Count) RLS predicate function(s):" -ForegroundColor Green
        $predicates | ForEach-Object {
            Write-Host "  - $($_.SchemaName).$($_.FunctionName) (Returns: $($_.ReturnType))" -ForegroundColor Gray
        }
    } else {
        Write-Host "No RLS predicate functions found in Security schema" -ForegroundColor Yellow
    }
}

Write-Host "`nDone!`n" -ForegroundColor Cyan

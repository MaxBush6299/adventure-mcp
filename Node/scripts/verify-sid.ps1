# Verify SID conversion for managed identity
# Object ID: ff27b331-3073-449a-b5dc-fa9e46c21cf2

$objectId = "ff27b331-3073-449a-b5dc-fa9e46c21cf2"

# Remove hyphens and convert to binary format
$guid = [System.Guid]::Parse($objectId)
$bytes = $guid.ToByteArray()

# Convert to hex string with 0x prefix (SQL Server SID format)
$sid = "0x" + ($bytes | ForEach-Object { $_.ToString("x2") }) -join ''

Write-Host "Object ID: $objectId"
Write-Host "SID (for SQL): $sid"
Write-Host ""
Write-Host "SQL Command to create user:"
Write-Host "CREATE USER [mssql-mcp-server-v2] WITH SID = $sid, TYPE = E;"

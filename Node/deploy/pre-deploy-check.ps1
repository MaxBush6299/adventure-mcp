# Pre-Deployment Checklist for MSSQL MCP Server
# Run this script to verify all prerequisites before deploying

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Pre-Deployment Checklist                 " -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

$allGood = $true

# 1. Check Azure CLI
Write-Host "[1/8] Checking Azure CLI..." -NoNewline
if (Get-Command az -ErrorAction SilentlyContinue) {
    $azVersion = az version --query '\"azure-cli\"' -o tsv 2>$null
    Write-Host " ✅ Installed (v$azVersion)" -ForegroundColor Green
} else {
    Write-Host " ❌ Not found" -ForegroundColor Red
    Write-Host "      Install: https://aka.ms/InstallAzureCLI" -ForegroundColor Yellow
    $allGood = $false
}

# 2. Check Azure Login
Write-Host "[2/8] Checking Azure login..." -NoNewline
$account = az account show 2>$null | ConvertFrom-Json
if ($account) {
    Write-Host " ✅ Logged in as $($account.user.name)" -ForegroundColor Green
} else {
    Write-Host " ❌ Not logged in" -ForegroundColor Red
    Write-Host "      Run: az login" -ForegroundColor Yellow
    $allGood = $false
}

# 3. Check Docker
Write-Host "[3/8] Checking Docker..." -NoNewline
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $dockerVersion = docker --version 2>$null
    Write-Host " ✅ $dockerVersion" -ForegroundColor Green
    
    # Check if Docker is running
    $dockerRunning = docker ps 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "       Docker daemon is running ✅" -ForegroundColor Green
    } else {
        Write-Host "       ❌ Docker daemon not running" -ForegroundColor Red
        Write-Host "       Start Docker Desktop" -ForegroundColor Yellow
        $allGood = $false
    }
} else {
    Write-Host " ❌ Not found" -ForegroundColor Red
    Write-Host "      Install Docker Desktop" -ForegroundColor Yellow
    $allGood = $false
}

# 4. Check TypeScript Build
Write-Host "[4/8] Checking TypeScript build..." -NoNewline
if (Test-Path "dist/index.js") {
    Write-Host " ✅ dist/index.js exists" -ForegroundColor Green
} else {
    Write-Host " ⚠️  Not built" -ForegroundColor Yellow
    Write-Host "      Run: npm run build" -ForegroundColor Yellow
    $buildNeeded = $true
}

# 5. Check Azure AD Credentials
Write-Host "[5/8] Checking Azure AD configuration..." -NoNewline
$hasClientSecret = $env:AZURE_CLIENT_SECRET -ne $null -and $env:AZURE_CLIENT_SECRET -ne ""
if ($hasClientSecret) {
    Write-Host " ✅ AZURE_CLIENT_SECRET found in environment" -ForegroundColor Green
} else {
    Write-Host " ⚠️  AZURE_CLIENT_SECRET not in environment" -ForegroundColor Yellow
    Write-Host "      Will prompt during deployment" -ForegroundColor Yellow
}

# 6. Check SQL Server Connectivity
Write-Host "[6/8] Checking SQL Server connectivity..." -NoNewline
$sqlServer = "adventureworks8700.database.windows.net"
$testConnection = Test-NetConnection -ComputerName $sqlServer -Port 1433 -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
if ($testConnection.TcpTestSucceeded) {
    Write-Host " ✅ Can reach $sqlServer:1433" -ForegroundColor Green
} else {
    Write-Host " ⚠️  Cannot reach $sqlServer:1433" -ForegroundColor Yellow
    Write-Host "      May need to add your IP to SQL firewall" -ForegroundColor Yellow
}

# 7. Check Deployment Files
Write-Host "[7/8] Checking deployment files..." -NoNewline
$requiredFiles = @(
    "deploy/deploy.ps1",
    "deploy/aci-deployment.bicep",
    "Dockerfile"
)
$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
    }
}
if ($missingFiles.Count -eq 0) {
    Write-Host " ✅ All files present" -ForegroundColor Green
} else {
    Write-Host " ❌ Missing files" -ForegroundColor Red
    foreach ($file in $missingFiles) {
        Write-Host "      - $file" -ForegroundColor Red
    }
    $allGood = $false
}

# 8. Check RLS Policies
Write-Host "[8/8] Checking RLS policies..." -NoNewline
Write-Host " ⚠️  Manual verification required" -ForegroundColor Yellow
Write-Host "      Ensure Security.Documents RLS policies are deployed" -ForegroundColor Yellow
Write-Host "      See: docs/TASK_1.6_RLS_POC.md" -ForegroundColor Yellow

# Summary
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Summary                                   " -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

if ($allGood) {
    Write-Host "✅ All critical prerequisites met!" -ForegroundColor Green
    Write-Host "`nYou're ready to deploy!`n" -ForegroundColor Green
    
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Update deploy/quick-deploy.ps1 with your ACR name"
    Write-Host "  2. Run: .\deploy\quick-deploy.ps1"
    Write-Host "  3. Follow the deployment prompts`n"
} else {
    Write-Host "❌ Some prerequisites are missing." -ForegroundColor Red
    Write-Host "Please fix the issues above before deploying.`n" -ForegroundColor Yellow
}

# Show configuration that will be used
Write-Host "Configuration to be deployed:" -ForegroundColor Cyan
Write-Host "  SQL Server:      adventureworks8700.database.windows.net"
Write-Host "  SQL Database:    adventureworks"
Write-Host "  Azure AD Tenant: 2e9b0657-eef8-47af-8747-5e89476faaab"
Write-Host "  Azure AD Client: 17a97781-0078-4478-8b4e-fe5dda9e2400"
Write-Host "  Require Auth:    true"
Write-Host "  Transport:       HTTP (port 8080)`n"

if ($buildNeeded) {
    Write-Host "Building TypeScript..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Build successful!`n" -ForegroundColor Green
    } else {
        Write-Host "❌ Build failed!`n" -ForegroundColor Red
    }
}

# Setup Azure Key Vault Secrets for RLS Implementation
# Run this script after creating the Azure AD App Registration

param(
    [Parameter(Mandatory=$true)]
    [string]$KeyVaultName,
    
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$true)]
    [string]$ClientId,
    
    [Parameter(Mandatory=$true)]
    [string]$ClientSecret
)

Write-Host "🔐 Storing Azure AD App Registration secrets in Key Vault..." -ForegroundColor Cyan
Write-Host ""

try {
    # Test if Key Vault exists
    $vault = az keyvault show --name $KeyVaultName 2>$null
    if (!$vault) {
        Write-Host "❌ Key Vault '$KeyVaultName' not found. Creating it..." -ForegroundColor Yellow
        
        # Get current subscription and resource group (you may need to adjust)
        $subscription = az account show --query id -o tsv
        Write-Host "Using subscription: $subscription"
        
        # Prompt for resource group
        $resourceGroup = Read-Host "Enter Resource Group name for Key Vault"
        $location = Read-Host "Enter Location (e.g., eastus)"
        
        # Create Key Vault
        az keyvault create `
            --name $KeyVaultName `
            --resource-group $resourceGroup `
            --location $location `
            --enable-rbac-authorization false
        
        Write-Host "✅ Key Vault created successfully!" -ForegroundColor Green
    }
    
    # Store secrets
    Write-Host "Storing AZURE-TENANT-ID..." -ForegroundColor Gray
    az keyvault secret set `
        --vault-name $KeyVaultName `
        --name "AZURE-TENANT-ID" `
        --value $TenantId `
        --output none
    
    Write-Host "Storing AZURE-CLIENT-ID..." -ForegroundColor Gray
    az keyvault secret set `
        --vault-name $KeyVaultName `
        --name "AZURE-CLIENT-ID" `
        --value $ClientId `
        --output none
    
    Write-Host "Storing AZURE-CLIENT-SECRET..." -ForegroundColor Gray
    az keyvault secret set `
        --vault-name $KeyVaultName `
        --name "AZURE-CLIENT-SECRET" `
        --value $ClientSecret `
        --output none
    
    Write-Host ""
    Write-Host "✅ All secrets stored successfully in Key Vault: $KeyVaultName" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 Key Vault Secret Names:" -ForegroundColor Cyan
    Write-Host "  - AZURE-TENANT-ID" -ForegroundColor White
    Write-Host "  - AZURE-CLIENT-ID" -ForegroundColor White
    Write-Host "  - AZURE-CLIENT-SECRET" -ForegroundColor White
    Write-Host ""
    Write-Host "🔗 Key Vault URI:" -ForegroundColor Cyan
    $vaultUri = az keyvault show --name $KeyVaultName --query properties.vaultUri -o tsv
    Write-Host "  $vaultUri" -ForegroundColor White
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Update your .env file or deployment scripts with these values" -ForegroundColor White
    Write-Host "2. Grant your MCP server managed identity access to Key Vault:" -ForegroundColor White
    Write-Host "   az keyvault set-policy --name $KeyVaultName --object-id <managed-identity-id> --secret-permissions get list" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ Error storing secrets: $_" -ForegroundColor Red
    exit 1
}

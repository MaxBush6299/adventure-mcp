#!/bin/bash

# MSSQL MCP Server - Azure Container Instance Deployment Script
# This script builds and deploys the containerized MCP server to Azure

set -e

# Configuration
RESOURCE_GROUP=""
LOCATION="eastus"
ACR_NAME=""
CONTAINER_GROUP_NAME="mssql-mcp-server"
SQL_SERVER_NAME=""
SQL_DATABASE_NAME=""
IMAGE_NAME="mssql-mcp-server"
IMAGE_TAG="latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Azure CLI is installed and logged in
check_azure_cli() {
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI is not installed. Please install it first."
        exit 1
    fi

    if ! az account show &> /dev/null; then
        log_error "Not logged into Azure. Please run 'az login' first."
        exit 1
    fi
}

# Validate required parameters
validate_params() {
    if [[ -z "$RESOURCE_GROUP" ]]; then
        log_error "RESOURCE_GROUP is required. Please set it in this script."
        exit 1
    fi

    if [[ -z "$ACR_NAME" ]]; then
        log_error "ACR_NAME is required. Please set it in this script."
        exit 1
    fi

    if [[ -z "$SQL_SERVER_NAME" ]]; then
        log_error "SQL_SERVER_NAME is required. Please set it in this script."
        exit 1
    fi

    if [[ -z "$SQL_DATABASE_NAME" ]]; then
        log_error "SQL_DATABASE_NAME is required. Please set it in this script."
        exit 1
    fi
}

# Build and push Docker image
build_and_push_image() {
    log_info "Building Docker image..."
    
    # Navigate to the Node directory
    cd "$(dirname "$0")/.."
    
    # Build the image
    docker build -t "${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}" .
    
    log_info "Logging into Azure Container Registry..."
    az acr login --name "$ACR_NAME"
    
    log_info "Pushing image to ACR..."
    docker push "${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}"
}

# Deploy using Bicep
deploy_container() {
    log_info "Deploying container to Azure Container Instances..."
    
    # Get ACR credentials
    ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query "username" -o tsv)
    ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)
    
    # Deploy using Bicep
    az deployment group create \
        --resource-group "$RESOURCE_GROUP" \
        --template-file "$(dirname "$0")/aci-deployment.bicep" \
        --parameters \
            containerGroupName="$CONTAINER_GROUP_NAME" \
            location="$LOCATION" \
            containerImage="${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}" \
            acrServer="${ACR_NAME}.azurecr.io" \
            acrUsername="$ACR_USERNAME" \
            acrPassword="$ACR_PASSWORD" \
            sqlServerName="$SQL_SERVER_NAME" \
            sqlDatabaseName="$SQL_DATABASE_NAME" \
            readOnlyMode=false \
            trustServerCertificate=false \
            connectionTimeout=30
}

# Get deployment outputs
get_outputs() {
    log_info "Retrieving deployment information..."
    
    FQDN=$(az deployment group show \
        --resource-group "$RESOURCE_GROUP" \
        --name "aci-deployment" \
        --query "properties.outputs.fqdn.value" -o tsv)
    
    PRINCIPAL_ID=$(az deployment group show \
        --resource-group "$RESOURCE_GROUP" \
        --name "aci-deployment" \
        --query "properties.outputs.principalId.value" -o tsv)
    
    MCP_ENDPOINT=$(az deployment group show \
        --resource-group "$RESOURCE_GROUP" \
        --name "aci-deployment" \
        --query "properties.outputs.mcpEndpoint.value" -o tsv)
    
    HEALTH_ENDPOINT=$(az deployment group show \
        --resource-group "$RESOURCE_GROUP" \
        --name "aci-deployment" \
        --query "properties.outputs.healthEndpoint.value" -o tsv)
    
    echo
    log_info "Deployment completed successfully!"
    echo
    echo "Container Group: $CONTAINER_GROUP_NAME"
    echo "FQDN: $FQDN"
    echo "Principal ID (for SQL permissions): $PRINCIPAL_ID"
    echo "MCP Endpoint: $MCP_ENDPOINT"
    echo "Health Check: $HEALTH_ENDPOINT"
    echo
    log_warn "IMPORTANT: Don't forget to grant SQL database access to the managed identity!"
    echo
    echo "Connect to your SQL database and run:"
    echo "CREATE USER [$CONTAINER_GROUP_NAME] FROM EXTERNAL PROVIDER;"
    echo "ALTER ROLE db_datareader ADD MEMBER [$CONTAINER_GROUP_NAME];"
    echo "ALTER ROLE db_datawriter ADD MEMBER [$CONTAINER_GROUP_NAME];"
    echo "ALTER ROLE db_ddladmin ADD MEMBER [$CONTAINER_GROUP_NAME];"
}

# Main execution
main() {
    log_info "Starting MSSQL MCP Server deployment..."
    
    # Validate environment
    check_azure_cli
    validate_params
    
    # Build and deploy
    build_and_push_image
    deploy_container
    get_outputs
    
    log_info "Deployment process completed!"
}

# Print usage if no parameters configured
if [[ -z "$RESOURCE_GROUP" && -z "$ACR_NAME" && -z "$SQL_SERVER_NAME" && -z "$SQL_DATABASE_NAME" ]]; then
    echo "MSSQL MCP Server Deployment Script"
    echo
    echo "Please configure the following variables in this script before running:"
    echo "  RESOURCE_GROUP     - Azure resource group name"
    echo "  ACR_NAME          - Azure Container Registry name"
    echo "  SQL_SERVER_NAME   - SQL Server name (e.g., myserver.database.windows.net)"
    echo "  SQL_DATABASE_NAME - SQL Database name"
    echo
    echo "Optional configuration:"
    echo "  LOCATION          - Azure region (default: eastus)"
    echo "  CONTAINER_GROUP_NAME - Container group name (default: mssql-mcp-server)"
    echo
    echo "Prerequisites:"
    echo "  - Azure CLI installed and logged in (az login)"
    echo "  - Docker installed and running"
    echo "  - Azure Container Registry created"
    echo "  - SQL Server and Database created"
    echo
    exit 1
fi

# Run main function
main
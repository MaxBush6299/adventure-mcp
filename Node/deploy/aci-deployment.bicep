// Azure Container Instance deployment for MSSQL MCP Server

// Parameters
@description('Name of the container group')
param containerGroupName string = 'mssql-mcp-server'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Container image from Azure Container Registry')
param containerImage string

@description('Azure Container Registry server URL')
param acrServer string

@description('Azure Container Registry username')
@secure()
param acrUsername string

@description('Azure Container Registry password')
@secure()
param acrPassword string

@description('SQL Server name (e.g., myserver.database.windows.net)')
param sqlServerName string

@description('SQL Database name')
param sqlDatabaseName string

@description('Whether to run in read-only mode')
param readOnlyMode bool = false

@description('Trust server certificate (for development)')
param trustServerCertificate bool = false

@description('Connection timeout in seconds')
param connectionTimeout int = 30

// Variables
var containerName = 'mssql-mcp-server'
var imageRegistryCredentials = [
  {
    server: acrServer
    username: acrUsername
    password: acrPassword
  }
]

// Resources
resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: containerGroupName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    containers: [
      {
        name: containerName
        properties: {
          image: containerImage
          ports: [
            {
              port: 8080
              protocol: 'TCP'
            }
          ]
          environmentVariables: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'MCP_TRANSPORT'
              value: 'http'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'SERVER_NAME'
              value: sqlServerName
            }
            {
              name: 'DATABASE_NAME'
              value: sqlDatabaseName
            }
            {
              name: 'READONLY'
              value: readOnlyMode ? 'true' : 'false'
            }
            {
              name: 'TRUST_SERVER_CERTIFICATE'
              value: trustServerCertificate ? 'true' : 'false'
            }
            {
              name: 'CONNECTION_TIMEOUT'
              value: string(connectionTimeout)
            }
          ]
          resources: {
            requests: {
              memoryInGB: 1
              cpu: 1
            }
          }
          livenessProbe: {
            httpGet: {
              path: '/health'
              port: 8080
              scheme: 'HTTP'
            }
            initialDelaySeconds: 30
            periodSeconds: 30
            timeoutSeconds: 5
            successThreshold: 1
            failureThreshold: 3
          }
          readinessProbe: {
            httpGet: {
              path: '/health'
              port: 8080
              scheme: 'HTTP'
            }
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
            successThreshold: 1
            failureThreshold: 3
          }
        }
      }
    ]
    imageRegistryCredentials: imageRegistryCredentials
    restartPolicy: 'Always'
    ipAddress: {
      type: 'Public'
      ports: [
        {
          port: 8080
          protocol: 'TCP'
        }
      ]
      dnsNameLabel: '${containerGroupName}-${uniqueString(resourceGroup().id)}'
    }
    osType: 'Linux'
  }
}

// Outputs
output containerGroupName string = containerGroup.name
output containerGroupId string = containerGroup.id
output principalId string = containerGroup.identity.principalId
output fqdn string = containerGroup.properties.ipAddress.fqdn
output ipAddress string = containerGroup.properties.ipAddress.ip
output mcpSseEndpoint string = 'http://${containerGroup.properties.ipAddress.fqdn}:8080/mcp'
output mcpMessageEndpoint string = 'http://${containerGroup.properties.ipAddress.fqdn}:8080/mcp/message'
output healthEndpoint string = 'http://${containerGroup.properties.ipAddress.fqdn}:8080/health'

// Instructions for database access (output as deployment script guidance)
output sqlPermissionInstructions string = '''
To grant the container's managed identity access to your SQL database, run these commands:

1. Connect to your SQL database using SQL Server Management Studio or Azure Data Studio
2. Run the following SQL commands:

   CREATE USER [${containerGroupName}] FROM EXTERNAL PROVIDER;
   ALTER ROLE db_datareader ADD MEMBER [${containerGroupName}];
   ALTER ROLE db_datawriter ADD MEMBER [${containerGroupName}];
   ALTER ROLE db_ddladmin ADD MEMBER [${containerGroupName}];

   -- For read-only access, use only:
   -- ALTER ROLE db_datareader ADD MEMBER [${containerGroupName}];

Note: The container group name used above should match your deployed container group name.
'''
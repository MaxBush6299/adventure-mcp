# MSSQL Database MCP Server

## What is this? 🤔

This is a server that lets your LLMs (like Claude, Azure AI Foundry agents) talk directly to your Azure SQL Database! Think of it as a friendly translator that sits between your AI assistant and your database, making sure they can chat securely and efficiently.

### Quick Example
```text
You: "Show me all customers from New York"
AI Agent: *queries your SQL Database and gives you the answer in plain English*
```

## Deployment Options 🚀

This MCP server supports two deployment modes:

1. **Stdio Mode** (original) - For Claude Desktop and VS Code Agent
2. **HTTP Mode** (new) - For Azure AI Foundry agents and web-based AI services

## How Does It Work? 🛠️

This server leverages the Model Context Protocol (MCP), a versatile framework that acts as a universal translator between AI models and databases. It supports multiple AI assistants including Claude Desktop, VS Code Agent, and Azure AI Foundry.

### Architecture Overview 🏗️

<div align="center">
  <img src="./Networking diagram.jpg" alt="MCP Server Architecture" width="700"/>
</div>

The architecture shows:
- **Entra ID (Azure AD)** authenticates users via HTTPS (Port 443) with token validation and OBO (On-Behalf-Of) exchange
- **MCP Server** runs in Azure Container Instances, accessible via HTTP (Port 8080)
- **Azure SQL Database** connects over TDS/TCP (Port 1433) with managed identity authentication
- **Semantic Kernel Agent** can optionally connect for AI orchestration using Azure OpenAI

### What Can It Do? 📊

- Run SQL Database queries by just asking questions in plain English
- Create, read, update, and delete data
- Manage database schema (tables, indexes)
- Secure Azure AD authentication with Managed Identity
- Real-time data interaction
- Containerized deployment to Azure Container Instances

### Available Tools 🔧

The MCP server provides **16 powerful tools** for database operations and discovery:

#### Data Operations
| Tool | Description |
|------|-------------|
| `insert_data` | Insert records into tables with support for single or batch operations |
| `read_data` | Execute SELECT queries to retrieve data from tables |
| `update_data` | Update records using WHERE clauses for precise modifications |
| `generate_synthetic_data` | **NEW!** Generate realistic test data based on table schema - Perfect for testing, demos, and development |

#### Schema Management
| Tool | Description |
|------|-------------|
| `create_table` | Create new tables with specified columns and data types |
| `create_index` | Create indexes on columns to improve query performance |
| `drop_table` | Remove tables from the database |
| `describe_table` | View table schema including columns, types, and constraints |

#### Database Discovery
| Tool | Description |
|------|-------------|
| `list_table` | List all tables in the database or filter by schema |
| `list_stored_procedures` | Discover stored procedures with optional schema filtering |
| `describe_stored_procedure` | View stored procedure parameters and definitions |
| `list_views` | List all database views with optional schema filtering |
| `list_functions` | List user-defined functions (scalar and table-valued) - **Essential for discovering RLS security predicates!** |
| `list_schemas` | List all schemas in the database |
| `get_table_row_count` | Get row counts for tables or entire schemas - **Useful for verifying Row-Level Security** |
| `list_triggers` | List database triggers with optional table filtering |

> **💡 Pro Tip**: The `list_functions` tool is particularly useful for discovering Row-Level Security (RLS) predicates like `fn_securitypredicate_*` functions that enforce per-user data isolation.

## Quick Start 🚀

Choose your deployment method:

### Option A: Container Deployment (Recommended for Production) 🐳

Perfect for Azure AI Foundry agents and production environments.

#### Prerequisites
- Azure CLI installed and logged in
- Docker Desktop installed
- Azure Container Registry
- Azure SQL Database
- **SQL Server admin access** (for managed identity setup)

#### Quick Deploy
```bash
# Configure the deployment script (Windows)
.\deploy\deploy.ps1 -ResourceGroup "my-rg" -AcrName "myacr" -SqlServerName "myserver.database.windows.net" -SqlDatabaseName "mydb"

# Or use bash (Linux/Mac)
./deploy/deploy.sh
```

⚠️ **IMPORTANT**: After deployment, you **MUST** configure managed identity permissions. See:
- **[Node/docs/MANAGED_IDENTITY_SETUP.md](Node/docs/MANAGED_IDENTITY_SETUP.md)** - Complete setup guide
- **[Node/docs/QUICK_REFERENCE.md](Node/docs/QUICK_REFERENCE.md)** - Quick reference card

See [Container Deployment Guide](#container-deployment-guide) for detailed instructions.

### Option B: Local Development Setup 🔧

For local development, testing, or stdio-based clients like Claude Desktop.

#### Prerequisites
- Node.js 18 or higher
- Claude Desktop or VS Code with Agent extension

#### Setup Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build the Project**
   ```bash
   npm run build
   ```

3. **Run in HTTP mode** (for testing)
   ```bash
   npm run start:http
   ```

4. **Run in stdio mode** (for Claude Desktop)
   ```bash
   npm start
   ```

## Documentation 📚

### Deployment & Setup
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide with Azure AI Projects configuration
- **[Node/docs/MANAGED_IDENTITY_SETUP.md](Node/docs/MANAGED_IDENTITY_SETUP.md)** - Managed identity setup (REQUIRED for production)
- **[Node/docs/QUICK_REFERENCE.md](Node/docs/QUICK_REFERENCE.md)** - Quick reference commands

### Troubleshooting
- **[Node/docs/TROUBLESHOOTING.md](Node/docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Node/docs/FIX_SUMMARY.md](Node/docs/FIX_SUMMARY.md)** - Recent authentication fix details

## Configuration Setup

### Option 1: VS Code Agent Setup

1. **Install VS Code Agent Extension**
   - Open VS Code
   - Go to Extensions (Ctrl+Shift+X)
   - Search for "Agent" and install the official Agent extension

2. **Create MCP Configuration File**
   - Create a `.vscode/mcp.json` file in your workspace
   - Add the following configuration:

   ```json
   {
     "servers": {
       "mssql-nodejs": {
          "type": "stdio",
          "command": "node",
          "args": ["q:\\Repos\\SQL-AI-samples\\MssqlMcp\\Node\\dist\\index.js"],
          "env": {
            "SERVER_NAME": "your-server-name.database.windows.net",
            "DATABASE_NAME": "your-database-name",
            "READONLY": "false"
          }
        }
      }
   }
   ```

3. **Alternative: User Settings Configuration**
   - Open VS Code Settings (Ctrl+,)
   - Search for "mcp"
   - Click "Edit in settings.json"
   - Add the following configuration:

  ```json
   {
    "mcp": {
        "servers": {
            "mssql": {
                "command": "node",
                "args": ["C:/path/to/your/Node/dist/index.js"],
                "env": {
                "SERVER_NAME": "your-server-name.database.windows.net",
                "DATABASE_NAME": "your-database-name",
                "READONLY": "false"
                }
            }
        }
    }
  }
  ```

4. **Restart VS Code**
   - Close and reopen VS Code for the changes to take effect

5. **Verify MCP Server**
   - Open Command Palette (Ctrl+Shift+P)
   - Run "MCP: List Servers" to verify your server is configured
   - You should see "mssql" in the list of available servers

### Option 2: Claude Desktop Setup

1. **Open Claude Desktop Settings**
   - Navigate to File → Settings → Developer → Edit Config
   - Open the `claude_desktop_config` file

2. **Add MCP Server Configuration**
   Replace the content with the configuration below, updating the path and credentials:

   ```json
   {
     "mcpServers": {
       "mssql": {
         "command": "node",
         "args": ["C:/path/to/your/Node/dist/index.js"],
         "env": {
           "SERVER_NAME": "your-server-name.database.windows.net",
           "DATABASE_NAME": "your-database-name",
           "READONLY": "false"
         }
       }
     }
   }
   ```

3. **Restart Claude Desktop**
   - Close and reopen Claude Desktop for the changes to take effect

### Configuration Parameters

- **SERVER_NAME**: Your MSSQL Database server name (e.g., `my-server.database.windows.net`)
- **DATABASE_NAME**: Your database name
- **READONLY**: Set to `"true"` to restrict to read-only operations, `"false"` for full access
- **Path**: Update the path in `args` to point to your actual project location.
- **CONNECTION_TIMEOUT**: (Optional) Connection timeout in seconds. Defaults to `30` if not set.
- **TRUST_SERVER_CERTIFICATE**: (Optional) Set to `"true"` to trust self-signed server certificates (useful for development or when connecting to servers with self-signed certs). Defaults to `"false"`.

## Sample Configurations

You can find sample configuration files in the `src/samples/` folder:
- `claude_desktop_config.json` - For Claude Desktop
- `vscode_agent_config.json` - For VS Code Agent

## Usage Examples

Once configured, you can interact with your database using natural language:

- "Show me all users from New York"
- "Create a new table called products with columns for id, name, and price"
- "Update all pending orders to completed status"
- "List all tables in the database"

## Security Notes

- The server requires a WHERE clause for read operations to prevent accidental full table scans
- Update operations require explicit WHERE clauses for security
- Set `READONLY: "true"` in production environments if you only need read access

## Container Deployment Guide 🐳

### Step 1: Prepare Azure Resources

1. **Create Resource Group**
   ```bash
   az group create --name "mcp-rg" --location "eastus"
   ```

2. **Create Azure Container Registry**
   ```bash
   az acr create --resource-group "mcp-rg" --name "mymcpacr" --sku Basic --admin-enabled true
   ```

3. **Ensure Azure SQL Database exists**
   - Your SQL Server should be accessible from Azure Container Instances
   - Note the server name (e.g., `myserver.database.windows.net`) and database name

### Step 2: Deploy Container

#### Windows (PowerShell)
```powershell
.\deploy\deploy.ps1 `
    -ResourceGroup "mcp-rg" `
    -AcrName "mymcpacr" `
    -SqlServerName "myserver.database.windows.net" `
    -SqlDatabaseName "mydatabase"
```

#### Linux/Mac (Bash)
```bash
# Edit deploy/deploy.sh and set these variables:
# RESOURCE_GROUP="mcp-rg"
# ACR_NAME="mymcpacr"  
# SQL_SERVER_NAME="myserver.database.windows.net"
# SQL_DATABASE_NAME="mydatabase"

./deploy/deploy.sh
```

### Step 3: Grant Database Access

After deployment, grant the container's managed identity access to your SQL database:

```sql
-- Connect to your SQL database and run:
CREATE USER [mssql-mcp-server] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [mssql-mcp-server];
ALTER ROLE db_datawriter ADD MEMBER [mssql-mcp-server];
ALTER ROLE db_ddladmin ADD MEMBER [mssql-mcp-server];
```

### Step 4: Test Deployment

```bash
# Test the health endpoint
curl http://your-container-fqdn:8080/health

# Or use the provided test script
node test/test-http-mcp.js
```

### Step 5: Configure AI Foundry Agent

Use the MCP endpoint in your Azure AI Foundry agent configuration:
- **MCP Server URL**: `http://your-container-fqdn:8080/mcp`
- **Transport**: Streamable HTTP
- **Authentication**: None (handled by container managed identity)

## Environment Variables

### Required
- `SERVER_NAME`: Azure SQL server name (e.g., `myserver.database.windows.net`)
- `DATABASE_NAME`: Database name

### Optional
- `READONLY`: Set to `"true"` for read-only access (default: `"false"`)
- `CONNECTION_TIMEOUT`: Connection timeout in seconds (default: `30`)
- `TRUST_SERVER_CERTIFICATE`: Trust self-signed certificates (default: `"false"`)
- `NODE_ENV`: Set to `"production"` to use DefaultAzureCredential (automatic in container)
- `MCP_TRANSPORT`: Set to `"http"` to force HTTP mode
- `PORT`: HTTP server port (default: `8080`)

## Testing

### Local HTTP Testing
```bash
# Start server in HTTP mode
npm run start:http

# Run tests against local server
node test/test-http-mcp.js

# Test against remote server
MCP_SERVER_URL=http://remote-server:8080 node test/test-http-mcp.js
```

### Health Check
```bash
curl http://localhost:8080/health
```

## Architecture

```
┌─────────────────┐    HTTP/SSE     ┌─────────────────┐    Azure AD      ┌──────────────────┐
│   AI Foundry    │ ──────────────→ │   MCP Server    │ ──────────────→  │   Azure SQL      │
│     Agent       │                 │  (Container)    │   (Managed ID)   │    Database      │
└─────────────────┘                 └─────────────────┘                  └──────────────────┘
```

## Security Features

- **Managed Identity**: Secure authentication to Azure SQL without credentials
- **SQL Injection Protection**: Comprehensive input validation and parameterized queries  
- **Read-only Mode**: Optional restriction to SELECT operations only
- **CORS Configuration**: Configurable cross-origin access controls
- **Health Monitoring**: Built-in health checks and graceful shutdown

## Production Deployment 🚀

For detailed production deployment instructions, troubleshooting, and Azure AI Projects integration, see:

📋 **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete production deployment guide

> **Note**: DEPLOYMENT.md contains deployment-specific details and is excluded from version control for security.

## Troubleshooting

### Common Issues

1. **Container fails to start**
   - Check Azure Container Registry credentials
   - Verify image build and push succeeded
   - Check container logs: `az container logs --resource-group <rg> --name <container-group>`

2. **Database connection fails**
   - Ensure managed identity has been granted database access
   - Check SQL server firewall allows Azure services
   - Verify SERVER_NAME and DATABASE_NAME environment variables

3. **MCP client can't connect**
   - Verify container has public IP and port 8080 is accessible
   - Test health endpoint: `curl http://<fqdn>:8080/health`
   - Check CORS configuration if accessing from browser

4. **Azure AI Projects JSON-RPC Errors (-32000)**
   - Ensure server properly handles POST requests to `/mcp` endpoint
   - Verify JSON-RPC 2.0 format compliance
   - Test with: `{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}`

5. **Azure AI Projects 404 Errors**
   - Check if Azure AI Projects is configured with correct endpoint URL
   - Try alternative endpoints: `/tools`, `/tools/list`, `/mcp/tools`
   - Verify container FQDN is correct and accessible

### Logs and Monitoring

```bash
# View container logs
az container logs --resource-group <rg> --name <container-group>

# View deployment details
az deployment group show --resource-group <rg> --name aci-deployment

# Check container status
az container show --resource-group <rg> --name <container-group> --query "containers[0].instanceView"

# Get container FQDN
az container show --resource-group <rg> --name <container-group> --query "ipAddress.fqdn" --output tsv
```

### Debugging Server Issues

```powershell
# Test all endpoints at once
$fqdn = "your-container-fqdn:8080"

# Health check
try { Invoke-RestMethod -Uri "http://$fqdn/health" } catch { Write-Host "Health failed: $_" }

# JSON-RPC 2.0
try { Invoke-RestMethod -Uri "http://$fqdn/mcp" -Method Post -ContentType "application/json" -Body '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' } catch { Write-Host "JSON-RPC failed: $_" }

# REST endpoints  
try { Invoke-RestMethod -Uri "http://$fqdn/tools" } catch { Write-Host "REST /tools failed: $_" }
try { Invoke-RestMethod -Uri "http://$fqdn/tools/list" } catch { Write-Host "REST /tools/list failed: $_" }
try { Invoke-RestMethod -Uri "http://$fqdn/mcp/tools" } catch { Write-Host "REST /mcp/tools failed: $_" }
```

You now have a production-ready, containerized MCP server that enables AI agents to securely interact with your Azure SQL Database!

---

## 🚀 Roadmap & Planned Features

We're continuously improving the MCP server! Here's what's coming next:

### Version 1.2.0 (Planned) 🎯

#### **Role-Based Access Control (RBAC) for Tools**
**Status:** 📋 Planned | **Priority:** High | **Effort:** 6-8 hours

Implement fine-grained security to control which tools users can access based on their Azure AD roles.

**Key Features:**
- **Role Extraction:** Extract roles from JWT token claims (app roles, groups, custom claims)
- **Configurable Policies:** Define which roles can use which tools via JSON configuration
- **Tool Filtering:** Users only see tools they have permission to use
- **Authorization Checks:** Validate permissions before executing any tool
- **Clear Error Messages:** "Access denied: User role 'DataReader' not authorized to use tool 'drop_table'"

**Example Roles:**
```typescript
{
  'SysAdmin': '*',           // All 16 tools
  'DataReader': [            // Read-only tools
    'read_data', 'list_table', 'describe_table', 
    'list_views', 'get_table_row_count', ...
  ],
  'DataWriter': [            // Read/write tools
    'read_data', 'insert_data', 'update_data',
    'generate_synthetic_data', ...
  ],
  'SchemaAdmin': [           // Schema management
    'create_table', 'drop_table', 'create_index', ...
  ]
}
```

**Benefits:**
- ✅ Enforces principle of least privilege
- ✅ Prevents unauthorized destructive operations
- ✅ Improves compliance and auditability
- ✅ Better user experience (only see relevant tools)
- ✅ Configurable via environment variables or JSON files
- ✅ Backward compatible (can be disabled)

**Configuration:**
```bash
# Enable RBAC
ENABLE_RBAC=true

# Custom policy (optional)
TOOL_ACCESS_POLICY_FILE=/app/config/tool-access-policy.json

# Default role for users without roles
DEFAULT_USER_ROLE=DataReader
```

---

### Version 1.3.0 (Planned) 🔌

#### **On-Premises SQL Server Support**
**Status:** 📋 Planned | **Priority:** High | **Effort:** 8-12 hours

Expand compatibility to hybrid and on-premises SQL Server environments with multiple authentication modes.

**Key Features:**
- **Multiple Auth Modes:**
  - Azure AD (current) - OAuth 2.0 with token-based authentication
  - SQL Authentication - Traditional username/password
  - Windows Authentication - Domain-based authentication
  
- **Connection Strategy Pattern:**
  - Per-user connection pools for Azure AD (RLS support)
  - Shared connection pool for SQL Auth and Windows Auth
  - Automatic strategy selection based on AUTH_MODE

- **Flexible Configuration:**
  ```bash
  # Azure AD mode (current)
  AUTH_MODE=azure-ad
  
  # SQL Authentication for on-prem
  AUTH_MODE=sql-auth
  SQL_AUTH_USERNAME=sa
  SQL_AUTH_PASSWORD=YourPassword123!
  
  # Windows Authentication
  AUTH_MODE=windows-auth
  ```

**Benefits:**
- ✅ Connect to on-premises SQL Server instances
- ✅ Support hybrid cloud/on-prem environments
- ✅ No breaking changes (defaults to Azure AD mode)
- ✅ Choose authentication method per deployment
- ⚠️ RLS features only available in Azure AD mode

---

### Future Enhancements 💡

#### **Synthetic Data Tool Improvements**
- Integration with faker.js for even more realistic data
- Foreign key awareness (generate related records automatically)
- Custom data templates via JSON configuration
- Data generation from existing row patterns
- Performance optimization for 100K+ row datasets

#### **Performance & Monitoring**
- Connection health monitoring and auto-reconnection
- Query performance metrics and telemetry
- Configurable connection pool sizes
- Query result caching
- Admin dashboard for monitoring

#### **Advanced Features**
- Stored procedure execution with parameters
- GraphQL endpoint as alternative to JSON-RPC
- Time-based role assignments (temporary access)
- Attribute-Based Access Control (ABAC)
- Multi-tenancy support (database-per-tenant)
- Certificate-based authentication

---

## 📚 Documentation

For detailed information, check out our comprehensive documentation:

- **[TODO.md](./Node/docs/TODO.md)** - Complete roadmap with implementation details
- **[SYNTHETIC_DATA_IMPLEMENTATION.md](./Node/docs/SYNTHETIC_DATA_IMPLEMENTATION.md)** - Synthetic data tool guide
- **[DEPLOYMENT_GUIDE.md](./Node/docs/DEPLOYMENT_GUIDE.md)** - Step-by-step deployment instructions
- **[TROUBLESHOOTING.md](./Node/docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[QUICK_REFERENCE.md](./Node/docs/QUICK_REFERENCE.md)** - Quick reference for all tools and features

---

## 🤝 Contributing

We welcome contributions! If you'd like to implement any of the planned features or have suggestions for new ones, please:

1. Open an issue to discuss your proposed changes
2. Submit a pull request with your implementation

---

## 📝 License

See [LICENSE](./Node/LICENSE) file for details.

---

## 🎉 Recent Updates

### October 9, 2025
- ✅ **Added Synthetic Data Generation Tool** - Generate realistic test data with intelligent pattern matching (25+ column patterns)
- ✅ **Deployed to Production** - All 16 tools verified and accessible in Azure Container Instances
- ✅ **Updated Documentation** - Comprehensive guides for new features
- ✅ **Improved Architecture Diagram** - Added networking diagram showing complete flow

### Previous Updates
- ✅ Added 7 database discovery tools (stored procedures, views, functions, schemas, triggers, row counts)
- ✅ Fixed introspection endpoint caching issue
- ✅ Consolidated deployment scripts for easier deployment
- ✅ Enhanced README with complete tool reference table

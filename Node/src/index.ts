#!/usr/bin/env node

// Load environment variables from parent directory (repository root)
import * as dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from repository root (parent of Node directory)
dotenv.config({ path: join(__dirname, '../../.env') });

// External imports
import sql from "mssql";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import { IncomingMessage, ServerResponse } from "http";

// Internal imports
import { UpdateDataTool } from "./tools/UpdateDataTool.js";
import { InsertDataTool } from "./tools/InsertDataTool.js";
import { ReadDataTool } from "./tools/ReadDataTool.js";
import { CreateTableTool } from "./tools/CreateTableTool.js";
import { CreateIndexTool } from "./tools/CreateIndexTool.js";
import { ListTableTool } from "./tools/ListTableTool.js";
import { DropTableTool } from "./tools/DropTableTool.js";
import { DescribeTableTool } from "./tools/DescribeTableTool.js";
import { ListStoredProceduresTool } from "./tools/ListStoredProceduresTool.js";
import { DescribeStoredProcedureTool } from "./tools/DescribeStoredProcedureTool.js";
import { ListViewsTool } from "./tools/ListViewsTool.js";
import { ListFunctionsTool } from "./tools/ListFunctionsTool.js";
import { ListSchemasTool } from "./tools/ListSchemasTool.js";
import { GetTableRowCountTool } from "./tools/GetTableRowCountTool.js";
import { ListTriggersTool } from "./tools/ListTriggersTool.js";
import { GenerateSyntheticDataTool } from "./tools/GenerateSyntheticDataTool.js";
import { CheckDatabaseHealthTool } from "./tools/CheckDatabaseHealthTool.js";
import { MonitorQueryPerformanceTool } from "./tools/MonitorQueryPerformanceTool.js";
import { AnalyzeIndexUsageTool } from "./tools/AnalyzeIndexUsageTool.js";
import { DefaultAzureCredential, ManagedIdentityCredential, InteractiveBrowserCredential } from "@azure/identity";
import { ToolContext } from "./tools/ToolContext.js";

// Auth imports
import { TokenValidator, TokenValidationConfig } from "./auth/index.js";
import { createAuthMiddleware } from "./middleware/index.js";

// Database imports
import { TokenExchangeService, SqlConfigService, ConnectionPoolManager, PoolManagerConfig } from "./database/index.js";

// MSSQL Database connection configuration
// const credential = new DefaultAzureCredential();

// Globals for connection and token reuse
let globalSqlPool: sql.ConnectionPool | null = null;
let globalAccessToken: string | null = null;
let globalTokenExpiresOn: Date | null = null;

// Export function to get the global SQL pool for backward compatibility
export function getGlobalSqlPool(): sql.ConnectionPool | null {
  return globalSqlPool;
}

// Function to create SQL config with fresh access token, returns token and expiry
export async function createSqlConfig(): Promise<{ config: sql.config, token: string, expiresOn: Date }> {
  // Use ManagedIdentityCredential explicitly for container environments
  // Falls back to InteractiveBrowserCredential for local development
  console.log(`[AUTH] Environment: ${process.env.NODE_ENV}, using ${process.env.NODE_ENV === 'production' ? 'ManagedIdentityCredential' : 'InteractiveBrowserCredential'}`);
  
  const credential = process.env.NODE_ENV === 'production' 
    ? new ManagedIdentityCredential()
    : new InteractiveBrowserCredential({
        redirectUri: 'http://localhost'
      });
  
  let accessToken;
  try {
    console.log('[AUTH] Acquiring Azure AD token for SQL Database...');
    // Use the correct scope with /.default suffix for managed identity
    accessToken = await credential.getToken('https://database.windows.net/.default');
    console.log(`[AUTH] Token acquired successfully, expires at: ${accessToken?.expiresOnTimestamp ? new Date(accessToken.expiresOnTimestamp).toISOString() : 'unknown'}`);
    console.log(`[AUTH] Token length: ${accessToken?.token?.length || 0} characters`);
  } catch (error) {
    console.error('[AUTH] Failed to acquire Azure AD token:', error);
    throw error;
  }

  const trustServerCertificate = process.env.TRUST_SERVER_CERTIFICATE?.toLowerCase() === 'true';
  const connectionTimeout = process.env.CONNECTION_TIMEOUT ? parseInt(process.env.CONNECTION_TIMEOUT, 10) : 30;

  return {
    config: {
      server: process.env.SERVER_NAME!,
      database: process.env.DATABASE_NAME!,
      port: 1433, // Explicit port for SQL Server
      options: {
        encrypt: true,
        trustServerCertificate,
        enableArithAbort: true // Sometimes needed for Azure SQL
      },
      authentication: {
        type: 'azure-active-directory-access-token',
        options: {
          token: accessToken?.token!
        }
      },
      connectionTimeout: connectionTimeout * 1000, // convert seconds to milliseconds
    },
    token: accessToken?.token!,
    expiresOn: accessToken?.expiresOnTimestamp ? new Date(accessToken.expiresOnTimestamp) : new Date(Date.now() + 30 * 60 * 1000)
  };
}

const updateDataTool = new UpdateDataTool();
const insertDataTool = new InsertDataTool();
const readDataTool = new ReadDataTool();
const createTableTool = new CreateTableTool();
const createIndexTool = new CreateIndexTool();
const listTableTool = new ListTableTool();
const dropTableTool = new DropTableTool();
const describeTableTool = new DescribeTableTool();
const listStoredProceduresTool = new ListStoredProceduresTool();
const describeStoredProcedureTool = new DescribeStoredProcedureTool();
const listViewsTool = new ListViewsTool();
const listFunctionsTool = new ListFunctionsTool();
const listSchemasTool = new ListSchemasTool();
const getTableRowCountTool = new GetTableRowCountTool();
const listTriggersTool = new ListTriggersTool();
const generateSyntheticDataTool = new GenerateSyntheticDataTool();
const checkDatabaseHealthTool = new CheckDatabaseHealthTool();
const monitorQueryPerformanceTool = new MonitorQueryPerformanceTool();
const analyzeIndexUsageTool = new AnalyzeIndexUsageTool();

const server = new Server(
  {
    name: "mssql-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Read READONLY env variable
const isReadOnly = process.env.READONLY === "true";

// Cache for tools list to improve performance
let cachedToolsList: any = null;
function getToolsList() {
  if (!cachedToolsList) {
    console.log('[CACHE] Building tools list cache...');
    const availableTools = isReadOnly
      ? [listTableTool, readDataTool, describeTableTool, listStoredProceduresTool, describeStoredProcedureTool, listViewsTool, listFunctionsTool, listSchemasTool, getTableRowCountTool, listTriggersTool, checkDatabaseHealthTool, monitorQueryPerformanceTool, analyzeIndexUsageTool]
      : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, listStoredProceduresTool, describeStoredProcedureTool, listViewsTool, listFunctionsTool, listSchemasTool, getTableRowCountTool, listTriggersTool, generateSyntheticDataTool, checkDatabaseHealthTool, monitorQueryPerformanceTool, analyzeIndexUsageTool];
    
    cachedToolsList = availableTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
    console.log(`[CACHE] Cached ${cachedToolsList.length} tools`);
  }
  return cachedToolsList;
}

// Request handlers

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = isReadOnly
    ? [listTableTool, readDataTool, describeTableTool, listStoredProceduresTool, describeStoredProcedureTool, listViewsTool, listFunctionsTool, listSchemasTool, getTableRowCountTool, listTriggersTool]
    : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, listStoredProceduresTool, describeStoredProcedureTool, listViewsTool, listFunctionsTool, listSchemasTool, getTableRowCountTool, listTriggersTool, generateSyntheticDataTool];
  
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case insertDataTool.name:
        result = await insertDataTool.run(args);
        break;
      case readDataTool.name:
        result = await readDataTool.run(args);
        break;
      case updateDataTool.name:
        result = await updateDataTool.run(args);
        break;
      case createTableTool.name:
        result = await createTableTool.run(args);
        break;
      case createIndexTool.name:
        result = await createIndexTool.run(args);
        break;
      case listTableTool.name:
        result = await listTableTool.run(args);
        break;
      case dropTableTool.name:
        result = await dropTableTool.run(args);
        break;
      case describeTableTool.name:
        if (!args || typeof args.tableName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'tableName' argument for describe_table tool.` }],
            isError: true,
          };
        }
        result = await describeTableTool.run(args as { tableName: string });
        break;
      case listStoredProceduresTool.name:
        result = await listStoredProceduresTool.run(args);
        break;
      case describeStoredProcedureTool.name:
        if (!args || typeof args.procedureName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'procedureName' argument for describe_stored_procedure tool.` }],
            isError: true,
          };
        }
        result = await describeStoredProcedureTool.run(args);
        break;
      case listViewsTool.name:
        result = await listViewsTool.run(args);
        break;
      case listFunctionsTool.name:
        result = await listFunctionsTool.run(args);
        break;
      case listSchemasTool.name:
        result = await listSchemasTool.run(args);
        break;
      case getTableRowCountTool.name:
        result = await getTableRowCountTool.run(args);
        break;
      case listTriggersTool.name:
        result = await listTriggersTool.run(args);
        break;
      case generateSyntheticDataTool.name:
        result = await generateSyntheticDataTool.run(args);
        break;
      case checkDatabaseHealthTool.name:
        result = await checkDatabaseHealthTool.run(args);
        break;
      case monitorQueryPerformanceTool.name:
        result = await monitorQueryPerformanceTool.run(args);
        break;
      case analyzeIndexUsageTool.name:
        result = await analyzeIndexUsageTool.run(args);
        break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error occurred: ${error}` }],
      isError: true,
    };
  }
});

// Server startup
async function runServer() {
  try {
    // Check if HTTP mode is requested
    const useHttp = process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http';
    
    if (useHttp) {
      await runHttpServer();
    } else {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    }
  } catch (error) {
    console.error("Fatal error running server:", error);
    process.exit(1);
  }
}

// Store active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

async function runHttpServer() {
  const app = express();
  const port = process.env.PORT || 8080;
  
  // Initialize token validator (optional - only if AZURE_CLIENT_ID is set)
  let tokenValidator: TokenValidator | null = null;
  let tokenExchangeService: TokenExchangeService | null = null;
  let sqlConfigService: SqlConfigService | null = null;
  let poolManager: ConnectionPoolManager | null = null;
  const requireAuth = process.env.REQUIRE_AUTH === 'true';
  
  if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID) {
    console.log('[AUTH] Initializing token validator with Azure AD configuration');
    
    // Use AZURE_EXPECTED_AUDIENCE if set (e.g., "api://client-id"), otherwise fall back to AZURE_CLIENT_ID
    const expectedAudience = process.env.AZURE_EXPECTED_AUDIENCE || process.env.AZURE_CLIENT_ID;
    
    const tokenConfig: TokenValidationConfig = {
      tenantId: process.env.AZURE_TENANT_ID,
      audience: expectedAudience,
      issuer: `https://sts.windows.net/${process.env.AZURE_TENANT_ID}/`,
      validateSignature: true,
      clockTolerance: 60
    };
    
    console.log(`[AUTH] Expected audience: ${expectedAudience}`);
    tokenValidator = new TokenValidator(tokenConfig);
    console.log('[AUTH] Token validator initialized successfully');
    
    // Initialize token exchange service for OBO flow
    if (process.env.AZURE_CLIENT_SECRET) {
      console.log('[OBO] Initializing token exchange service');
      
      tokenExchangeService = new TokenExchangeService({
        tenantId: process.env.AZURE_TENANT_ID,
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET
      });
      
      // Initialize SQL config service
      sqlConfigService = new SqlConfigService(tokenExchangeService, {
        serverName: process.env.SERVER_NAME!,
        databaseName: process.env.DATABASE_NAME!,
        trustServerCertificate: process.env.TRUST_SERVER_CERTIFICATE?.toLowerCase() === 'true',
        connectionTimeout: process.env.CONNECTION_TIMEOUT ? parseInt(process.env.CONNECTION_TIMEOUT, 10) : 30
      });
      
      console.log('[OBO] Token exchange service initialized successfully');
      
      // Initialize Connection Pool Manager
      console.log('[PoolManager] Initializing connection pool manager');
      
      const poolManagerConfig: PoolManagerConfig = {
        maxUsers: parseInt(process.env.MAX_CONCURRENT_USERS || '100', 10),
        idleTimeout: parseInt(process.env.POOL_IDLE_TIMEOUT || '300000', 10), // 5 minutes default
        cleanupInterval: parseInt(process.env.POOL_CLEANUP_INTERVAL || '60000', 10), // 1 minute default
        tokenRefreshBuffer: 5 * 60 * 1000, // 5 minutes before expiry
        sqlConfig: {
          server: process.env.SERVER_NAME!,
          database: process.env.DATABASE_NAME!,
          port: 1433,
          trustServerCertificate: process.env.TRUST_SERVER_CERTIFICATE?.toLowerCase() === 'true',
          connectionTimeout: process.env.CONNECTION_TIMEOUT ? parseInt(process.env.CONNECTION_TIMEOUT, 10) : 30
        }
      };
      
      poolManager = new ConnectionPoolManager(poolManagerConfig);
      poolManager.startCleanup();
      
      console.log('[PoolManager] Connection pool manager initialized successfully');
      
      // Start periodic token cleanup (every 5 minutes)
      setInterval(() => {
        const cleaned = tokenExchangeService!.cleanupExpiredTokens();
        if (cleaned > 0) {
          console.log(`[OBO] Periodic cleanup removed ${cleaned} expired tokens`);
        }
      }, 5 * 60 * 1000);
      
    } else {
      console.log('[OBO] Token exchange not configured (missing AZURE_CLIENT_SECRET)');
      console.log('[OBO] Per-user authentication will not be available');
    }
    
  } else {
    console.log('[AUTH] Token validator not configured (missing AZURE_TENANT_ID or AZURE_CLIENT_ID)');
    if (requireAuth) {
      console.error('[AUTH] ERROR: REQUIRE_AUTH is true but auth is not configured!');
      throw new Error('REQUIRE_AUTH is enabled but Azure AD configuration is missing');
    }
  }
  
  // Middleware
  app.use(cors({
    origin: '*', // Allow all origins as requested
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
  }));
  app.use(express.json());
  
  // Add optional auth middleware if configured
  // This will parse tokens if present but NOT block requests without tokens
  // We'll check authentication on specific routes/methods that need protection
  if (tokenValidator) {
    console.log(`[AUTH] Adding optional auth middleware (will be required on specific routes)`);
    app.use(createAuthMiddleware({
      tokenValidator,
      required: false,  // Changed: Allow anonymous access by default
      logErrors: true
    }));
  }
  
  // Add request timeout middleware
  app.use((req, res, next) => {
    // Configurable timeout for requests (Phase 2 FK detection needs more time)
    const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT || '60000', 10);
    res.setTimeout(requestTimeout, () => {
      console.error(`[${new Date().toISOString()}] Request timeout: ${req.method} ${req.path}`);
      if (!res.headersSent) {
        res.status(504).json({
          error: 'Request timeout',
          message: `The request took too long to process (>${requestTimeout / 1000}s)`
        });
      }
    });
    next();
  });
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });
  
  // Pool manager health endpoint
  app.get('/health/pools', (req, res) => {
    if (!poolManager) {
      res.status(503).json({
        status: 'unavailable',
        message: 'Connection pool manager not initialized',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    const stats = poolManager.getPoolStats();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      poolManager: {
        ...stats,
        memoryEstimate: `${Math.round(stats.activePools * 50)} MB (estimated)`,
        utilizationPercent: Math.round((stats.activePools / 100) * 100) // Assuming maxUsers=100
      }
    });
  });
  
  // Legacy REST endpoints for tools (backward compatibility)
  app.get('/mcp/tools', async (req, res) => {
    res.json({
      tools: getToolsList()
    });
  });

  // Alternative tools/list endpoint (some MCP clients expect this)
  app.get('/tools/list', async (req, res) => {
    res.json({
      tools: getToolsList()
    });
  });

  // Alternative root tools endpoint
  app.get('/tools', async (req, res) => {
    res.json({
      tools: getToolsList()
    });
  });

  app.get('/mcp/capabilities', (req, res) => {
    res.json({
      capabilities: {
        tools: { listTools: true }
      }
    });
  });

  // MCP Introspection endpoint - provides complete server information
  app.get('/mcp/introspect', (req, res) => {
    res.json({
      server: {
        name: "MSSQL MCP Server",
        version: "1.0.0",
        description: "Model Context Protocol server for Microsoft SQL Server database operations"
      },
      capabilities: {
        tools: { listTools: true }
      },
      tools: getToolsList(),
      configuration: {
        readOnlyMode: isReadOnly,
        sqlServer: process.env.SQL_SERVER || 'Not configured',
        sqlDatabase: process.env.SQL_DATABASE || 'Not configured'
      },
      endpoints: [
        { path: "/health", method: "GET", description: "Health check endpoint", authentication: "none" },
        { path: "/health/pools", method: "GET", description: "Pool manager health check", authentication: "none" },
        { path: "/mcp/tools", method: "GET", description: "List available tools", authentication: "none" },
        { path: "/tools", method: "GET", description: "List available tools (alternative)", authentication: "none" },
        { path: "/tools/list", method: "GET", description: "List available tools (alternative 2)", authentication: "none" },
        { path: "/mcp/capabilities", method: "GET", description: "Server capabilities", authentication: "none" },
        { path: "/mcp/introspect", method: "GET", description: "Full server introspection", authentication: "none" },
        { path: "/mcp", method: "GET", description: "MCP server information", authentication: "none" },
        { path: "/mcp", method: "POST", description: "MCP JSON-RPC 2.0 endpoint", authentication: requireAuth ? "required for tools/call" : "optional" },
        { path: "/mcp/sse", method: "GET", description: "MCP SSE connection endpoint (legacy)", authentication: "optional" },
        { path: "/mcp/message", method: "POST", description: "MCP message handling endpoint", authentication: "optional" }
      ]
    });
  });
  
  // MCP endpoint - handle both GET and POST requests
  // GET request returns server info, POST handles JSON-RPC 2.0
  app.get('/mcp', async (req: express.Request, res: express.Response) => {
    // Add Streamable HTTP headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-MCP-Protocol-Version', '2024-11-05');
    res.setHeader('X-MCP-Transport', 'streamable-http');
    
    // Some MCP clients expect GET /mcp to return server information
    res.json({
      server: {
        name: "MSSQL MCP Server",
        version: "1.0.0",
        description: "Model Context Protocol server for Microsoft SQL Server database operations"
      },
      capabilities: {
        tools: { listTools: true }
      },
      tools: getToolsList(),
      transport: "streamable-http",
      protocolVersion: "2024-11-05",
      endpoints: {
        "initialize": "POST /mcp with JSON-RPC 2.0 (public)",
        "tools/list": "GET /mcp or POST /mcp with JSON-RPC 2.0 (public)",
        "tools/call": requireAuth ? "POST /mcp with JSON-RPC 2.0 (requires authentication)" : "POST /mcp with JSON-RPC 2.0 (optional authentication)", 
        "ping": "POST /mcp with JSON-RPC 2.0 (public)"
      }
    });
  });

  // MCP JSON-RPC 2.0 endpoint - handles direct JSON-RPC requests
  app.post('/mcp', async (req: express.Request, res: express.Response) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    
    console.log(`\n========== MCP REQUEST [${requestId}] ==========`);
    console.log(`[${new Date().toISOString()}] Method: ${req.body?.method || 'unknown'}`);
    console.log(`[${new Date().toISOString()}] Request ID: ${req.body?.id}`);
    console.log(`[${new Date().toISOString()}] Accept Header: ${req.headers['accept'] || 'none'}`);
    console.log(`[${new Date().toISOString()}] Content-Type: ${req.headers['content-type'] || 'none'}`);
    console.log(`[${new Date().toISOString()}] Request Body: ${JSON.stringify(req.body).substring(0, 200)}...`);
    
    // Check if client accepts Server-Sent Events (for Copilot Studio compatibility)
    const acceptHeader = req.headers['accept'] || '';
    const useSSE = acceptHeader.includes('text/event-stream');
    
    // Add appropriate headers based on requested format
    if (useSSE) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('Connection', 'keep-alive');
      console.log(`[${new Date().toISOString()}] Response format: SSE (Server-Sent Events)`);
    } else {
      res.setHeader('Content-Type', 'application/json');
      console.log(`[${new Date().toISOString()}] Response format: JSON`);
    }
    res.setHeader('X-MCP-Protocol-Version', '2024-11-05');
    res.setHeader('X-MCP-Transport', 'streamable-http');
    
    try {
      const { jsonrpc, method, params, id } = req.body;

      // Validate JSON-RPC 2.0 format
      if (jsonrpc !== '2.0' || !method) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request',
            data: 'Missing or invalid jsonrpc version or method'
          },
          id: id || null
        });
        return;
      }

      // Check authentication for tools/call when REQUIRE_AUTH is enabled
      if (method === 'tools/call' && requireAuth && !(req as any).userContext) {
        console.error(`[${new Date().toISOString()}] tools/call requires authentication but no user context present`);
        res.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Authentication required',
            data: 'tools/call method requires a valid Bearer token in Authorization header'
          },
          id
        });
        return;
      }

      let result;
      
      switch (method) {
        case 'initialize':
          // Handle initialize request - required by MCP protocol
          console.log(`[${new Date().toISOString()}] Processing initialize request`);
          
          result = {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {
                listChanged: true  // Tells client that tools list can change and should be queried
              },
              logging: {}
            },
            serverInfo: {
              name: "MSSQL MCP Server",
              version: "1.0.0"
            }
          };
          
          console.log(`[${new Date().toISOString()}] initialize completed successfully`);
          break;

        case 'tools/list':
          // Handle tools/list request - use cached response for instant reply
          console.log(`[${new Date().toISOString()}] Processing tools/list request (cached)`);
          
          result = {
            tools: getToolsList()
          };
          
          console.log(`[${new Date().toISOString()}] tools/list returning ${result.tools.length} tools from cache`);
          break;

        case 'tools/call':
          // Handle tools/call request
          if (!params || !params.name) {
            res.status(400).json({
              jsonrpc: '2.0',
              error: {
                code: -32602,
                message: 'Invalid params',
                data: 'Missing tool name'
              },
              id
            });
            return;
          }

          const toolName = params.name;
          const toolArgs = params.arguments || {};

          try {
            // Create ToolContext if user is authenticated and services are available
            let toolContext: ToolContext | undefined = undefined;
            
            if ((req as any).userContext && tokenExchangeService && poolManager) {
              const userContext = (req as any).userContext;
              const userAccessToken = userContext.getAccessToken();
              const userId = userContext.getUserId();
              
              try {
                // Get SQL token via OBO flow
                const sqlTokenInfo = await tokenExchangeService.getSqlTokenWithExpiry(userAccessToken, userId);
                
                // Create ToolContext with user identity and pool manager
                toolContext = {
                  userIdentity: {
                    userId: userId,
                    oid: userId,
                    upn: userContext.getUPN(),
                    email: userContext.getUPN(),
                    name: userContext.getName(),
                    tenantId: userContext.getTenantId(),
                    accessToken: userAccessToken,
                    sqlToken: sqlTokenInfo.token,
                    tokenExpiry: sqlTokenInfo.expiresOn,
                    groups: userContext.getGroups(),
                    roles: userContext.getRoles(),
                    claims: userContext.getAllClaims()
                  },
                  poolManager: poolManager
                };
                
                console.log(`[HTTP] Created ToolContext for user ${userContext.getUPN()} (OID: ${userId})`);
              } catch (error) {
                console.error(`[HTTP] Failed to create ToolContext for ${userContext.getUPN()}:`, error);
                // Fall back to no context (backward compatibility)
              }
            }

            let toolResult;
            switch (toolName) {
              case insertDataTool.name:
                toolResult = await insertDataTool.run(toolArgs, toolContext);
                break;
              case readDataTool.name:
                toolResult = await readDataTool.run(toolArgs, toolContext);
                break;
              case updateDataTool.name:
                toolResult = await updateDataTool.run(toolArgs, toolContext);
                break;
              case createTableTool.name:
                toolResult = await createTableTool.run(toolArgs, toolContext);
                break;
              case createIndexTool.name:
                toolResult = await createIndexTool.run(toolArgs, toolContext);
                break;
              case listTableTool.name:
                toolResult = await listTableTool.run(toolArgs, toolContext);
                break;
              case dropTableTool.name:
                toolResult = await dropTableTool.run(toolArgs, toolContext);
                break;
              case describeTableTool.name:
                if (!toolArgs || typeof toolArgs.tableName !== "string") {
                  res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                      code: -32602,
                      message: 'Invalid params',
                      data: `Missing or invalid 'tableName' argument for describe_table tool.`
                    },
                    id
                  });
                  return;
                }
                toolResult = await describeTableTool.run(toolArgs as { tableName: string }, toolContext);
                break;
              case listStoredProceduresTool.name:
                toolResult = await listStoredProceduresTool.run(toolArgs, toolContext);
                break;
              case describeStoredProcedureTool.name:
                if (!toolArgs || typeof toolArgs.procedureName !== "string") {
                  res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                      code: -32602,
                      message: 'Invalid params',
                      data: `Missing or invalid 'procedureName' argument for describe_stored_procedure tool.`
                    },
                    id
                  });
                  return;
                }
                toolResult = await describeStoredProcedureTool.run(toolArgs, toolContext);
                break;
              case listViewsTool.name:
                toolResult = await listViewsTool.run(toolArgs, toolContext);
                break;
              case listFunctionsTool.name:
                toolResult = await listFunctionsTool.run(toolArgs, toolContext);
                break;
              case listSchemasTool.name:
                toolResult = await listSchemasTool.run(toolArgs, toolContext);
                break;
              case getTableRowCountTool.name:
                toolResult = await getTableRowCountTool.run(toolArgs, toolContext);
                break;
              case listTriggersTool.name:
                toolResult = await listTriggersTool.run(toolArgs, toolContext);
                break;
              case generateSyntheticDataTool.name:
                toolResult = await generateSyntheticDataTool.run(toolArgs, toolContext);
                break;
              case checkDatabaseHealthTool.name:
                toolResult = await checkDatabaseHealthTool.run(toolArgs, toolContext);
                break;
              case monitorQueryPerformanceTool.name:
                toolResult = await monitorQueryPerformanceTool.run(toolArgs, toolContext);
                break;
              case analyzeIndexUsageTool.name:
                toolResult = await analyzeIndexUsageTool.run(toolArgs, toolContext);
                break;
              default:
                res.status(400).json({
                  jsonrpc: '2.0',
                  error: {
                    code: -32601,
                    message: 'Method not found',
                    data: `Unknown tool: ${toolName}`
                  },
                  id
                });
                return;
            }

            result = {
              content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }]
            };
          } catch (error) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Server error',
                data: `Tool execution failed: ${error}`
              },
              id
            });
            return;
          }
          break;

        case 'notifications/initialized':
          // Handle initialized notification - required by MCP protocol after initialize
          console.log(`[${new Date().toISOString()}] Processing notifications/initialized`);
          
          // For notifications in SSE mode, send acknowledgment in SSE format
          // For JSON mode, send empty 200 response
          if (useSSE) {
            const sseAck = `event: message\ndata: {"jsonrpc":"2.0"}\n\n`;
            console.log(`[${new Date().toISOString()}] SUCCESS [${requestId}] notifications/initialized - SSE acknowledgment sent`);
            console.log(`========== END REQUEST [${requestId}] ==========\n`);
            res.send(sseAck);
          } else {
            console.log(`[${new Date().toISOString()}] SUCCESS [${requestId}] notifications/initialized - JSON acknowledgment sent`);
            console.log(`========== END REQUEST [${requestId}] ==========\n`);
            res.status(200).end();
          }
          return;

        case 'ping':
          // Handle ping request for health check - respond immediately
          console.log(`[${new Date().toISOString()}] Processing ping request`);
          result = { status: 'ok', timestamp: new Date().toISOString() };
          break;

        default:
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: 'Method not found',
              data: `Unknown method: ${method}`
            },
            id
          });
          return;
      }

      // Return successful JSON-RPC 2.0 response
      const duration = Date.now() - startTime;
      
      const responseData = {
        jsonrpc: '2.0',
        result,
        id
      };
      
      if (useSSE) {
        // Send in SSE format for Copilot Studio compatibility
        const sseMessage = `event: message\ndata: ${JSON.stringify(responseData)}\n\n`;
        console.log(`[${new Date().toISOString()}] SUCCESS [${requestId}] ${req.body?.method} (${duration}ms)`);
        console.log(`[${new Date().toISOString()}] SSE Response (first 300 chars): ${sseMessage.substring(0, 300)}...`);
        console.log(`========== END REQUEST [${requestId}] ==========\n`);
        res.send(sseMessage);
      } else {
        // Send as JSON (default)
        console.log(`[${new Date().toISOString()}] SUCCESS [${requestId}] ${req.body?.method} (${duration}ms)`);
        console.log(`[${new Date().toISOString()}] JSON Response (first 300 chars): ${JSON.stringify(responseData).substring(0, 300)}...`);
        console.log(`========== END REQUEST [${requestId}] ==========\n`);
        res.json(responseData);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[${new Date().toISOString()}] JSON-RPC Error: ${req.body?.method} (${duration}ms):`, error);
      
      const errorResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Server error',
          data: `Internal server error: ${error}`
        },
        id: req.body?.id || null
      };
      
      // Check if client accepts SSE format
      const acceptHeader = req.headers['accept'] || '';
      const useSSE = acceptHeader.includes('text/event-stream');
      
      if (useSSE) {
        // Send error in SSE format
        const sseMessage = `event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`;
        res.status(500).send(sseMessage);
      } else {
        // Send as JSON (default)
        res.status(500).json(errorResponse);
      }
    }
  });

  // MCP SSE endpoint - establishes the SSE connection (kept for backward compatibility)
  app.get('/mcp/sse', async (req: express.Request, res: express.Response) => {
    try {
      // Create SSE transport
      const transport = new SSEServerTransport('/mcp/message', res as any as ServerResponse);
      
      // Store transport by session ID for message routing
      await transport.start();
      const sessionId = transport.sessionId;
      activeTransports.set(sessionId, transport);
      
      // Connect MCP server to this transport
      await server.connect(transport);
      
      // Clean up on close
      transport.onclose = () => {
        activeTransports.delete(sessionId);
        console.log(`SSE connection closed for session: ${sessionId}`);
      };
      
      transport.onerror = (error) => {
        console.error(`SSE transport error for session ${sessionId}:`, error);
        activeTransports.delete(sessionId);
      };
      
      console.log(`SSE connection established for session: ${sessionId}`);
    } catch (error) {
      console.error('Error establishing SSE connection:', error);
      res.status(500).json({ error: 'Failed to establish SSE connection' });
    }
  });
  
  // MCP message endpoint - receives POST messages
  app.post('/mcp/message', async (req: express.Request, res: express.Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      
      if (!sessionId) {
        res.status(400).json({ error: 'Missing sessionId parameter' });
        return;
      }
      
      const transport = activeTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      
      // Handle the message through the transport
      await transport.handlePostMessage(req as any as IncomingMessage, res as any as ServerResponse, req.body);
    } catch (error) {
      console.error('Error handling POST message:', error);
      res.status(500).json({ error: 'Failed to handle message' });
    }
  });
  
  // Start the HTTP server
  const httpServer = app.listen(port, () => {
    console.log(`MCP Server running on HTTP at port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`MCP JSON-RPC 2.0 endpoint: http://localhost:${port}/mcp`);
    console.log(`MCP SSE endpoint (legacy): http://localhost:${port}/mcp/sse`);
    console.log(`Tools endpoint: http://localhost:${port}/mcp/tools`);
    console.log(`Introspection: http://localhost:${port}/mcp/introspect`);
  });
  
  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    
    // Close all connection pools
    if (poolManager) {
      try {
        await poolManager.closeAllPools();
      } catch (error) {
        console.error('Error closing connection pools:', error);
      }
    }
    
    // Close all active transports
    for (const transport of activeTransports.values()) {
      try {
        await transport.close();
      } catch (error) {
        console.error('Error closing transport:', error);
      }
    }
    activeTransports.clear();
    
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});

// Connect to SQL only when handling a request
// Look to add access token from https://learn.microsoft.com/en-us/azure/app-service/tutorial-connect-app-access-sql-database-as-user-dotnet
// ensure scope is set properly. It is logon as user, see about providing offline access as scope. Token expires after 4 hours, offline access allows for the token to be refreshed.
// offline access would enable alert functionality


async function ensureSqlConnection() { 
  console.log(`[SQL] Checking SQL connection status...`);
  
  // If we have a pool and it's connected, and the token is still valid, reuse it
  if (
    globalSqlPool &&
    globalSqlPool.connected &&
    globalAccessToken &&
    globalTokenExpiresOn &&
    globalTokenExpiresOn > new Date(Date.now() + 2 * 60 * 1000) // 2 min buffer
  ) {
    console.log(`[SQL] Reusing existing connection, token expires: ${globalTokenExpiresOn.toISOString()}`);
    return;
  }

  console.log(`[SQL] Creating new SQL connection...`);
  
  // Otherwise, get a new token and reconnect
  const { config, token, expiresOn } = await createSqlConfig();
  globalAccessToken = token; //Look to implement this as the entra ID token
  globalTokenExpiresOn = expiresOn;

  console.log(`[SQL] Config created - Server: ${config.server}, Database: ${config.database}`);
  console.log(`[SQL] Auth type: ${config.authentication?.type}`);

  // Close old pool if exists
  if (globalSqlPool && globalSqlPool.connected) {
    console.log(`[SQL] Closing existing pool...`);
    await globalSqlPool.close();
  }

  try {
    console.log(`[SQL] Connecting to SQL Server...`);
    globalSqlPool = await sql.connect(config);
    console.log(`[SQL] ✅ Connected successfully!`);
  } catch (error) {
    console.error(`[SQL] ❌ Connection failed:`, error);
    throw error;
  }
}

// Patch all tool handlers to ensure SQL connection before running
function wrapToolRun(tool: { run: (...args: any[]) => Promise<any> }) {
  const originalRun = tool.run.bind(tool);
  tool.run = async function (...args: any[]) {
    await ensureSqlConnection();
    return originalRun(...args);
  };
}

[insertDataTool, readDataTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, describeTableTool].forEach(wrapToolRun);
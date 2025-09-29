#!/usr/bin/env node

// Load environment variables
import * as dotenv from "dotenv";
dotenv.config();

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
import { DefaultAzureCredential, InteractiveBrowserCredential } from "@azure/identity";
import { DescribeTableTool } from "./tools/DescribeTableTool.js";

// MSSQL Database connection configuration
// const credential = new DefaultAzureCredential();

// Globals for connection and token reuse
let globalSqlPool: sql.ConnectionPool | null = null;
let globalAccessToken: string | null = null;
let globalTokenExpiresOn: Date | null = null;

// Function to create SQL config with fresh access token, returns token and expiry
export async function createSqlConfig(): Promise<{ config: sql.config, token: string, expiresOn: Date }> {
  // Use DefaultAzureCredential for container environments (Managed Identity)
  // Falls back to InteractiveBrowserCredential for local development
  const credential = process.env.NODE_ENV === 'production' 
    ? new DefaultAzureCredential()
    : new InteractiveBrowserCredential({
        redirectUri: 'http://localhost'
      });
  const accessToken = await credential.getToken('https://database.windows.net/.default');

  const trustServerCertificate = process.env.TRUST_SERVER_CERTIFICATE?.toLowerCase() === 'true';
  const connectionTimeout = process.env.CONNECTION_TIMEOUT ? parseInt(process.env.CONNECTION_TIMEOUT, 10) : 30;

  return {
    config: {
      server: process.env.SERVER_NAME!,
      database: process.env.DATABASE_NAME!,
      options: {
        encrypt: true,
        trustServerCertificate
      },
      authentication: {
        type: 'azure-active-directory-access-token',
        options: {
          token: accessToken?.token!,
        },
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

// Request handlers

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: isReadOnly
    ? [listTableTool, readDataTool, describeTableTool] // todo: add searchDataTool to the list of tools available in readonly mode once implemented
    : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool], // add all new tools here
}));

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
  
  // Middleware
  app.use(cors({
    origin: '*', // Allow all origins as requested
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
  }));
  app.use(express.json());
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });
  
  // MCP SSE endpoint - establishes the SSE connection
  app.get('/mcp', async (req: express.Request, res: express.Response) => {
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
    console.log(`MCP SSE endpoint: http://localhost:${port}/mcp`);
    console.log(`MCP Message endpoint: http://localhost:${port}/mcp/message`);
  });
  
  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    
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

async function ensureSqlConnection() {
  // If we have a pool and it's connected, and the token is still valid, reuse it
  if (
    globalSqlPool &&
    globalSqlPool.connected &&
    globalAccessToken &&
    globalTokenExpiresOn &&
    globalTokenExpiresOn > new Date(Date.now() + 2 * 60 * 1000) // 2 min buffer
  ) {
    return;
  }

  // Otherwise, get a new token and reconnect
  const { config, token, expiresOn } = await createSqlConfig();
  globalAccessToken = token;
  globalTokenExpiresOn = expiresOn;

  // Close old pool if exists
  if (globalSqlPool && globalSqlPool.connected) {
    await globalSqlPool.close();
  }

  globalSqlPool = await sql.connect(config);
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
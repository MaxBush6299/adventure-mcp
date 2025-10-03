import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class CreateIndexTool implements Tool {
  [key: string]: any;
  name = "create_index";
  description = "Creates an index on a specified column or columns in an MSSQL Database table";
  inputSchema = {
    type: "object",
    properties: {
      schemaName: { type: "string", description: "Name of the schema containing the table" },
      tableName: { type: "string", description: "Name of the table to create index on" },
      indexName: { type: "string", description: "Name for the new index" },
      columns: { 
        type: "array", 
        items: { type: "string" },
        description: "Array of column names to include in the index" 
      },
      isUnique: { 
        type: "boolean", 
        description: "Whether the index should enforce uniqueness (default: false)",
        default: false
      },
      isClustered: { 
        type: "boolean", 
        description: "Whether the index should be clustered (default: false)",
        default: false
      },
    },
    required: ["tableName", "indexName", "columns"],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { schemaName, tableName, indexName, columns, isUnique = false, isClustered = false } = params;

      let indexType = isClustered ? "CLUSTERED" : "NONCLUSTERED";
      if (isUnique) {
        indexType = `UNIQUE ${indexType}`;
      }
      const columnNames = columns.join(", ");

      const query = `CREATE ${indexType} INDEX ${indexName} ON ${schemaName}.${tableName} (${columnNames})`;
      
      // Get connection pool (per-user if authenticated, global if not)
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        // Authenticated mode: use per-user pool
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[CreateIndexTool] Using per-user pool for ${userEmail} (OID: ${userId})`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        // Non-authenticated mode: use global pool (backward compatibility)
        console.log(`[CreateIndexTool] Using global pool (no authentication)`);
        request = new sql.Request();
      }
      
      await request.query(query);
      
      return {
        success: true,
        message: `Index [${indexName}] created successfully on table [${schemaName}.${tableName}]`,
        details: {
          schemaName,
          tableName,
          indexName,
          columnNames,
          isUnique,
          isClustered
        }
      };
    } catch (error) {
      console.error("Error creating index:", error);
      return {
        success: false,
        message: `Failed to create index: ${error}`,
      };
    }
  }
}
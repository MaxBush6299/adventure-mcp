import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class ListViewsTool implements Tool {
  [key: string]: any;
  name = "list_views";
  description = "Lists views in an MSSQL Database, with optional schema filter";
  
  inputSchema = {
    type: "object",
    properties: {
      schemaName: { 
        type: "string", 
        description: "Schema to filter by (optional)"
      },
    },
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { schemaName } = params;
      
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[ListViewsTool] Using per-user pool for ${userEmail}`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[ListViewsTool] Using global pool`);
        request = new sql.Request();
      }
      
      const schemaFilter = schemaName ? `WHERE TABLE_SCHEMA = @schemaName` : "";
      const query = `
        SELECT 
          TABLE_SCHEMA AS SchemaName,
          TABLE_NAME AS ViewName
        FROM INFORMATION_SCHEMA.VIEWS
        ${schemaFilter}
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `;
      
      if (schemaName) {
        request.input("schemaName", sql.NVarChar, schemaName);
      }
      
      const result = await request.query(query);
      
      return {
        success: true,
        views: result.recordset,
        count: result.recordset.length
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to list views: ${error}`,
      };
    }
  }
}

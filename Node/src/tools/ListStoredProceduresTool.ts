import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class ListStoredProceduresTool implements Tool {
  [key: string]: any;
  name = "list_stored_procedures";
  description = "Lists stored procedures in an MSSQL Database, with optional schema filter";
  
  inputSchema = {
    type: "object",
    properties: {
      schemaName: { 
        type: "string", 
        description: "Schema to filter by (optional, e.g., 'dbo', 'Security')"
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
        console.log(`[ListStoredProceduresTool] Using per-user pool for ${userEmail}`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[ListStoredProceduresTool] Using global pool`);
        request = new sql.Request();
      }
      
      const schemaFilter = schemaName 
        ? `WHERE ROUTINE_SCHEMA = @schemaName` 
        : "";
      
      const query = `
        SELECT 
          ROUTINE_SCHEMA AS SchemaName,
          ROUTINE_NAME AS ProcedureName,
          CREATED AS CreatedDate,
          LAST_ALTERED AS LastModified
        FROM INFORMATION_SCHEMA.ROUTINES 
        WHERE ROUTINE_TYPE = 'PROCEDURE'
        ${schemaFilter ? 'AND ' + schemaFilter.replace('WHERE ', '') : ''}
        ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
      `;
      
      if (schemaName) {
        request.input("schemaName", sql.NVarChar, schemaName);
      }
      
      const result = await request.query(query);
      
      return {
        success: true,
        procedures: result.recordset,
        count: result.recordset.length
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to list stored procedures: ${error}`,
      };
    }
  }
}

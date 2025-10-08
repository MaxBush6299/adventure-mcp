import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class ListSchemasTool implements Tool {
  [key: string]: any;
  name = "list_schemas";
  description = "Lists all schemas in an MSSQL Database";
  
  inputSchema = {
    type: "object",
    properties: {},
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[ListSchemasTool] Using per-user pool for ${userEmail}`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[ListSchemasTool] Using global pool`);
        request = new sql.Request();
      }
      
      const query = `
        SELECT 
          name AS SchemaName,
          schema_id AS SchemaId
        FROM sys.schemas
        WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner', 
                           'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
                           'db_backupoperator', 'db_datareader', 'db_datawriter', 
                           'db_denydatareader', 'db_denydatawriter')
        ORDER BY name
      `;
      
      const result = await request.query(query);
      
      return {
        success: true,
        schemas: result.recordset,
        count: result.recordset.length
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to list schemas: ${error}`,
      };
    }
  }
}

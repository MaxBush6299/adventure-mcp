import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class ListTriggersTool implements Tool {
  [key: string]: any;
  name = "list_triggers";
  description = "Lists database triggers, optionally filtered by table";
  
  inputSchema = {
    type: "object",
    properties: {
      tableName: { 
        type: "string", 
        description: "Table name to filter triggers (optional)"
      },
    },
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { tableName } = params;
      
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[ListTriggersTool] Using per-user pool for ${userEmail}`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[ListTriggersTool] Using global pool`);
        request = new sql.Request();
      }
      
      const tableFilter = tableName 
        ? `AND OBJECT_NAME(parent_id) = @tableName` 
        : "";
      
      const query = `
        SELECT 
          SCHEMA_NAME(t.schema_id) AS SchemaName,
          t.name AS TriggerName,
          OBJECT_NAME(t.parent_id) AS TableName,
          t.is_disabled AS IsDisabled,
          t.create_date AS CreatedDate,
          t.modify_date AS ModifiedDate
        FROM sys.triggers t
        WHERE t.parent_class = 1  -- Object triggers (not DDL)
        ${tableFilter}
        ORDER BY OBJECT_NAME(t.parent_id), t.name
      `;
      
      if (tableName) {
        request.input("tableName", sql.NVarChar, tableName);
      }
      
      const result = await request.query(query);
      
      return {
        success: true,
        triggers: result.recordset,
        count: result.recordset.length
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to list triggers: ${error}`,
      };
    }
  }
}

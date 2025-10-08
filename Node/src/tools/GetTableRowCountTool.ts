import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class GetTableRowCountTool implements Tool {
  [key: string]: any;
  name = "get_table_row_count";
  description = "Gets row count for a specific table or all tables in a schema";
  
  inputSchema = {
    type: "object",
    properties: {
      tableName: { 
        type: "string", 
        description: "Specific table name (optional, format: 'schema.table' or just 'table')"
      },
      schemaName: {
        type: "string",
        description: "Schema to get counts for all tables (optional)"
      }
    },
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { tableName, schemaName } = params;
      
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[GetTableRowCountTool] Using per-user pool for ${userEmail}`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[GetTableRowCountTool] Using global pool`);
        request = new sql.Request();
      }
      
      let query: string;
      
      if (tableName) {
        // Get count for specific table
        const parts = tableName.split('.');
        const schema = parts.length > 1 ? parts[0] : 'dbo';
        const table = parts.length > 1 ? parts[1] : parts[0];
        
        query = `
          SELECT 
            SCHEMA_NAME(t.schema_id) AS SchemaName,
            t.name AS TableName,
            SUM(p.rows) AS RowCount
          FROM sys.tables t
          INNER JOIN sys.partitions p ON t.object_id = p.object_id
          WHERE p.index_id IN (0, 1)
            AND SCHEMA_NAME(t.schema_id) = @schemaName
            AND t.name = @tableName
          GROUP BY SCHEMA_NAME(t.schema_id), t.name
        `;
        
        request.input("schemaName", sql.NVarChar, schema);
        request.input("tableName", sql.NVarChar, table);
        
      } else if (schemaName) {
        // Get counts for all tables in schema
        query = `
          SELECT 
            SCHEMA_NAME(t.schema_id) AS SchemaName,
            t.name AS TableName,
            SUM(p.rows) AS RowCount
          FROM sys.tables t
          INNER JOIN sys.partitions p ON t.object_id = p.object_id
          WHERE p.index_id IN (0, 1)
            AND SCHEMA_NAME(t.schema_id) = @schemaName
          GROUP BY SCHEMA_NAME(t.schema_id), t.name
          ORDER BY RowCount DESC
        `;
        
        request.input("schemaName", sql.NVarChar, schemaName);
        
      } else {
        // Get counts for all tables
        query = `
          SELECT 
            SCHEMA_NAME(t.schema_id) AS SchemaName,
            t.name AS TableName,
            SUM(p.rows) AS RowCount
          FROM sys.tables t
          INNER JOIN sys.partitions p ON t.object_id = p.object_id
          WHERE p.index_id IN (0, 1)
          GROUP BY SCHEMA_NAME(t.schema_id), t.name
          ORDER BY RowCount DESC
        `;
      }
      
      const result = await request.query(query);
      
      return {
        success: true,
        tables: result.recordset,
        count: result.recordset.length
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get row counts: ${error}`,
      };
    }
  }
}

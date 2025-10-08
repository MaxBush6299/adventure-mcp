import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';

export class DescribeStoredProcedureTool implements Tool {
  [key: string]: any;
  name = "describe_stored_procedure";
  description = "Describes a stored procedure's parameters and definition";
  
  inputSchema = {
    type: "object",
    properties: {
      procedureName: { 
        type: "string", 
        description: "Name of the stored procedure (e.g., 'dbo.GetCustomerOrders' or 'GetCustomerOrders')" 
      },
      schemaName: {
        type: "string",
        description: "Schema name (defaults to 'dbo' if not specified)"
      }
    },
    required: ["procedureName"],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { procedureName, schemaName = 'dbo' } = params;
      
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[DescribeStoredProcedureTool] Using per-user pool for ${userEmail}`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        console.log(`[DescribeStoredProcedureTool] Using global pool`);
        request = new sql.Request();
      }
      
      // Get procedure parameters
      const paramsQuery = `
        SELECT 
          PARAMETER_NAME AS Name,
          DATA_TYPE AS DataType,
          CHARACTER_MAXIMUM_LENGTH AS MaxLength,
          PARAMETER_MODE AS Mode,
          ORDINAL_POSITION AS Position
        FROM INFORMATION_SCHEMA.PARAMETERS
        WHERE SPECIFIC_SCHEMA = @schemaName
          AND SPECIFIC_NAME = @procedureName
        ORDER BY ORDINAL_POSITION
      `;
      
      request.input("schemaName", sql.NVarChar, schemaName);
      request.input("procedureName", sql.NVarChar, procedureName);
      
      const paramsResult = await request.query(paramsQuery);
      
      // Get procedure definition (optional - may require more permissions)
      const defRequest = isValidAuthContext(context) && context
        ? (await context.poolManager.getPoolForUser(
            context.userIdentity.oid || context.userIdentity.userId,
            context.userIdentity.sqlToken!,
            context.userIdentity.tokenExpiry!
          )).request()
        : new sql.Request();
        
      defRequest.input("schemaName", sql.NVarChar, schemaName);
      defRequest.input("procedureName", sql.NVarChar, procedureName);
      
      const defQuery = `
        SELECT ROUTINE_DEFINITION AS Definition
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_SCHEMA = @schemaName
          AND ROUTINE_NAME = @procedureName
          AND ROUTINE_TYPE = 'PROCEDURE'
      `;
      
      const defResult = await defRequest.query(defQuery);
      
      return {
        success: true,
        procedureName: `${schemaName}.${procedureName}`,
        parameters: paramsResult.recordset,
        definition: defResult.recordset.length > 0 ? defResult.recordset[0].Definition : null
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to describe stored procedure: ${error}`,
      };
    }
  }
}

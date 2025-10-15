import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';
import { getGlobalSqlPool } from '../index.js';

export class AnalyzeIndexUsageTool implements Tool {
  [key: string]: any;
  name = "analyze_index_usage";
  description = "Analyzes index usage patterns to identify unused indexes (wasting space), missing indexes (causing slow queries), duplicate indexes (inefficient), and fragmented indexes (needing maintenance). Essential for database optimization.";
  inputSchema = {
    type: "object",
    properties: {
      schemaName: {
        type: "string",
        description: "Filter by specific schema (optional)",
      },
      tableName: {
        type: "string",
        description: "Filter by specific table (optional)",
      },
      analysisType: {
        type: "string",
        enum: ["unused", "missing", "duplicate", "all"],
        description: "Type of analysis: 'unused' (find unused indexes), 'missing' (suggest new indexes), 'duplicate' (find redundant indexes), 'all' (complete analysis)",
        default: "all"
      },
      minUnusedDays: {
        type: "number",
        description: "For unused analysis: minimum days since last use (default: 30)",
        minimum: 1,
        default: 30
      }
    },
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { schemaName, tableName, analysisType = 'all', minUnusedDays = 30 } = params;
      
      // Get connection pool (per-user if authenticated, global if not)
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        // Authenticated mode: use per-user pool
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[AnalyzeIndexUsageTool] Using per-user pool for ${userEmail} (OID: ${userId})`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        // Non-authenticated mode: use global pool (backward compatibility)
        console.log(`[AnalyzeIndexUsageTool] Using global pool (no authentication)`);
        const globalPool = getGlobalSqlPool();
        if (!globalPool) {
          throw new Error('Global SQL pool not available');
        }
        request = globalPool.request();
      }

      const result: any = {
        success: true,
        message: "Index analysis completed successfully",
        analysis_type: analysisType,
        filter: {
          schema: schemaName || 'all',
          table: tableName || 'all'
        }
      };

      // Build filter clauses
      const schemaFilter = schemaName ? `AND SCHEMA_NAME(t.schema_id) = @schemaName` : '';
      const tableFilter = tableName ? `AND t.name = @tableName` : '';

      if (schemaName) request.input('schemaName', sql.NVarChar, schemaName);
      if (tableName) request.input('tableName', sql.NVarChar, tableName);

      // Unused Indexes Analysis
      if (analysisType === 'unused' || analysisType === 'all') {
        const unusedQuery = `
          SELECT 
            SCHEMA_NAME(t.schema_id) AS schema_name,
            t.name AS table_name,
            i.name AS index_name,
            i.type_desc AS index_type,
            p.rows AS row_count,
            (SUM(a.total_pages) * 8) / 1024.0 AS size_mb,
            ISNULL(s.user_seeks, 0) AS user_seeks,
            ISNULL(s.user_scans, 0) AS user_scans,
            ISNULL(s.user_lookups, 0) AS user_lookups,
            ISNULL(s.user_updates, 0) AS user_updates,
            ISNULL(s.last_user_seek, '1900-01-01') AS last_user_seek,
            ISNULL(s.last_user_scan, '1900-01-01') AS last_user_scan,
            ISNULL(s.last_user_lookup, '1900-01-01') AS last_user_lookup,
            DATEDIFF(DAY, 
              CASE 
                WHEN s.last_user_seek IS NULL AND s.last_user_scan IS NULL AND s.last_user_lookup IS NULL 
                THEN GETDATE()
                ELSE (SELECT MAX(v) FROM (VALUES (s.last_user_seek), (s.last_user_scan), (s.last_user_lookup)) AS value(v))
              END, 
              GETDATE()) AS days_since_last_use,
            CASE 
              WHEN s.user_seeks IS NULL AND s.user_scans IS NULL AND s.user_lookups IS NULL 
                THEN 'NEVER USED: Consider dropping'
              WHEN (ISNULL(s.user_seeks, 0) + ISNULL(s.user_scans, 0) + ISNULL(s.user_lookups, 0)) = 0
                THEN 'NEVER READ: Only writes, consider dropping'
              WHEN ISNULL(s.user_updates, 0) > (ISNULL(s.user_seeks, 0) + ISNULL(s.user_scans, 0) + ISNULL(s.user_lookups, 0)) * 10
                THEN 'RARELY USED: Writes >> Reads, consider dropping'
              ELSE 'POTENTIALLY UNUSED: Review usage pattern'
            END AS recommendation
          FROM sys.indexes i
          INNER JOIN sys.tables t ON i.object_id = t.object_id
          LEFT JOIN sys.dm_db_index_usage_stats s ON i.object_id = s.object_id AND i.index_id = s.index_id AND s.database_id = DB_ID()
          INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
          INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
          WHERE 
            i.type_desc != 'HEAP'  -- Exclude heaps
            AND i.is_primary_key = 0  -- Exclude primary keys
            AND i.is_unique_constraint = 0  -- Exclude unique constraints
            AND t.is_ms_shipped = 0  -- Exclude system tables
            ${schemaFilter}
            ${tableFilter}
            AND (
              -- Never used
              (s.user_seeks IS NULL AND s.user_scans IS NULL AND s.user_lookups IS NULL)
              OR 
              -- Rarely used
              (ISNULL(s.user_seeks, 0) + ISNULL(s.user_scans, 0) + ISNULL(s.user_lookups, 0) < ISNULL(s.user_updates, 0))
              OR
              -- Not used recently
              (DATEDIFF(DAY, 
                (SELECT MAX(v) FROM (VALUES (s.last_user_seek), (s.last_user_scan), (s.last_user_lookup)) AS value(v)), 
                GETDATE()) > @minUnusedDays)
            )
          GROUP BY 
            SCHEMA_NAME(t.schema_id), t.name, i.name, i.type_desc, p.rows,
            s.user_seeks, s.user_scans, s.user_lookups, s.user_updates,
            s.last_user_seek, s.last_user_scan, s.last_user_lookup
          ORDER BY size_mb DESC
        `;
        
        request.input('minUnusedDays', sql.Int, minUnusedDays);
        const unusedResult = await request.query(unusedQuery);
        
        result.unused_indexes = {
          count: unusedResult.recordset.length,
          total_wasted_space_mb: unusedResult.recordset.reduce((sum: number, row: any) => sum + row.size_mb, 0),
          indexes: unusedResult.recordset.map((row: any) => ({
            schema_name: row.schema_name,
            table_name: row.table_name,
            index_name: row.index_name,
            index_type: row.index_type,
            row_count: row.row_count,
            size_mb: Math.round(row.size_mb * 100) / 100,
            usage: {
              user_seeks: row.user_seeks,
              user_scans: row.user_scans,
              user_lookups: row.user_lookups,
              user_updates: row.user_updates,
              days_since_last_use: row.days_since_last_use
            },
            recommendation: row.recommendation
          }))
        };
      }

      // Missing Indexes Analysis
      if (analysisType === 'missing' || analysisType === 'all') {
        const missingQuery = `
          SELECT TOP 20
            SCHEMA_NAME(t.schema_id) AS schema_name,
            t.name AS table_name,
            mid.equality_columns,
            mid.inequality_columns,
            mid.included_columns,
            migs.unique_compiles,
            migs.user_seeks,
            migs.user_scans,
            migs.avg_total_user_cost,
            migs.avg_user_impact,
            (migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans)) AS improvement_measure,
            'CREATE NONCLUSTERED INDEX [IX_' + t.name + '_Missing_' + 
              CAST(mid.index_handle AS VARCHAR(10)) + '] ON [' + 
              SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] (' +
              ISNULL(mid.equality_columns, '') +
              CASE WHEN mid.equality_columns IS NOT NULL AND mid.inequality_columns IS NOT NULL THEN ', ' ELSE '' END +
              ISNULL(mid.inequality_columns, '') + ')' +
              ISNULL(' INCLUDE (' + mid.included_columns + ')', '') AS create_statement
          FROM sys.dm_db_missing_index_details mid
          INNER JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
          INNER JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
          INNER JOIN sys.tables t ON mid.object_id = t.object_id
          WHERE 
            mid.database_id = DB_ID()
            AND t.is_ms_shipped = 0
            ${schemaFilter}
            ${tableFilter}
          ORDER BY improvement_measure DESC
        `;
        
        const missingResult = await request.query(missingQuery);
        
        result.missing_indexes = {
          count: missingResult.recordset.length,
          indexes: missingResult.recordset.map((row: any, index: number) => ({
            rank: index + 1,
            schema_name: row.schema_name,
            table_name: row.table_name,
            equality_columns: row.equality_columns,
            inequality_columns: row.inequality_columns,
            included_columns: row.included_columns,
            impact: {
              user_seeks: row.user_seeks,
              user_scans: row.user_scans,
              avg_user_impact_percent: Math.round(row.avg_user_impact * 100) / 100,
              avg_total_user_cost: Math.round(row.avg_total_user_cost * 100) / 100,
              improvement_measure: Math.round(row.improvement_measure * 100) / 100
            },
            create_statement: row.create_statement,
            recommendation: row.improvement_measure > 100000 ? 'HIGH PRIORITY: Significant performance improvement expected' :
                           row.improvement_measure > 10000 ? 'MEDIUM PRIORITY: Moderate performance improvement' :
                           'LOW PRIORITY: Minor performance improvement'
          }))
        };
      }

      // Duplicate Indexes Analysis
      if (analysisType === 'duplicate' || analysisType === 'all') {
        const duplicateQuery = `
          WITH IndexColumns AS (
            SELECT 
              SCHEMA_NAME(t.schema_id) AS schema_name,
              t.name AS table_name,
              i.name AS index_name,
              i.index_id,
              i.type_desc,
              (SELECT STRING_AGG(CAST(c.name AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
               FROM sys.index_columns ic
               INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
              ) AS key_columns,
              (SELECT STRING_AGG(CAST(c.name AS NVARCHAR(MAX)), ', ') WITHIN GROUP (ORDER BY ic.index_column_id)
               FROM sys.index_columns ic
               INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
              ) AS included_columns,
              (SUM(ps.used_page_count) * 8) / 1024.0 AS size_mb
            FROM sys.indexes i
            INNER JOIN sys.tables t ON i.object_id = t.object_id
            INNER JOIN sys.dm_db_partition_stats ps ON i.object_id = ps.object_id AND i.index_id = ps.index_id
            WHERE 
              i.type_desc != 'HEAP'
              AND t.is_ms_shipped = 0
              ${schemaFilter}
              ${tableFilter}
            GROUP BY 
              SCHEMA_NAME(t.schema_id), t.name, i.name, i.index_id, i.type_desc, i.object_id
          )
          SELECT 
            ic1.schema_name,
            ic1.table_name,
            ic1.index_name AS index1_name,
            ic1.type_desc AS index1_type,
            ic1.size_mb AS index1_size_mb,
            ic2.index_name AS index2_name,
            ic2.type_desc AS index2_type,
            ic2.size_mb AS index2_size_mb,
            ic1.key_columns,
            ic1.included_columns AS index1_included,
            ic2.included_columns AS index2_included,
            CASE 
              WHEN ic1.key_columns = ic2.key_columns AND ISNULL(ic1.included_columns, '') = ISNULL(ic2.included_columns, '') 
                THEN 'EXACT DUPLICATE: Drop one index'
              WHEN ic1.key_columns = ic2.key_columns 
                THEN 'DUPLICATE KEYS: Different included columns, consolidate'
              WHEN ic1.key_columns LIKE ic2.key_columns + ',%' 
                THEN 'REDUNDANT: Index1 is superset, consider dropping Index2'
              WHEN ic2.key_columns LIKE ic1.key_columns + ',%' 
                THEN 'REDUNDANT: Index2 is superset, consider dropping Index1'
              ELSE 'SIMILAR: Review if both are needed'
            END AS recommendation
          FROM IndexColumns ic1
          INNER JOIN IndexColumns ic2 ON 
            ic1.schema_name = ic2.schema_name AND
            ic1.table_name = ic2.table_name AND
            ic1.index_id < ic2.index_id AND
            (ic1.key_columns = ic2.key_columns OR 
             ic1.key_columns LIKE ic2.key_columns + ',%' OR 
             ic2.key_columns LIKE ic1.key_columns + ',%')
          ORDER BY ic1.schema_name, ic1.table_name, ic1.index_name
        `;
        
        const duplicateResult = await request.query(duplicateQuery);
        
        result.duplicate_indexes = {
          count: duplicateResult.recordset.length,
          total_wasted_space_mb: duplicateResult.recordset.reduce((sum: number, row: any) => 
            sum + Math.min(row.index1_size_mb, row.index2_size_mb), 0),
          indexes: duplicateResult.recordset.map((row: any) => ({
            schema_name: row.schema_name,
            table_name: row.table_name,
            index1: {
              name: row.index1_name,
              type: row.index1_type,
              size_mb: Math.round(row.index1_size_mb * 100) / 100,
              included_columns: row.index1_included
            },
            index2: {
              name: row.index2_name,
              type: row.index2_type,
              size_mb: Math.round(row.index2_size_mb * 100) / 100,
              included_columns: row.index2_included
            },
            key_columns: row.key_columns,
            recommendation: row.recommendation
          }))
        };
      }

      // Generate overall recommendations
      result.recommendations = this.generateRecommendations(result, analysisType);

      return result;
    } catch (error: any) {
      console.error("Error analyzing index usage:", error);
      return {
        success: false,
        message: `Failed to analyze index usage: ${error.message || error}`,
      };
    }
  }

  private generateRecommendations(result: any, analysisType: string): string[] {
    const recommendations: string[] = [];

    if ((analysisType === 'unused' || analysisType === 'all') && result.unused_indexes) {
      if (result.unused_indexes.count > 0) {
        recommendations.push(`Found ${result.unused_indexes.count} unused indexes wasting ${Math.round(result.unused_indexes.total_wasted_space_mb)} MB. Consider dropping these after validating with your team.`);
      } else {
        recommendations.push('No unused indexes found - good index hygiene!');
      }
    }

    if ((analysisType === 'missing' || analysisType === 'all') && result.missing_indexes) {
      if (result.missing_indexes.count > 0) {
        const highPriority = result.missing_indexes.indexes.filter((idx: any) => 
          idx.recommendation.startsWith('HIGH PRIORITY')).length;
        if (highPriority > 0) {
          recommendations.push(`Found ${highPriority} high-priority missing indexes that could significantly improve performance.`);
        }
        recommendations.push(`SQL Server suggests ${result.missing_indexes.count} missing indexes. Review and create the high-impact ones first.`);
      } else {
        recommendations.push('No missing indexes suggested - queries may already be well-optimized.');
      }
    }

    if ((analysisType === 'duplicate' || analysisType === 'all') && result.duplicate_indexes) {
      if (result.duplicate_indexes.count > 0) {
        recommendations.push(`Found ${result.duplicate_indexes.count} duplicate or redundant indexes wasting ~${Math.round(result.duplicate_indexes.total_wasted_space_mb)} MB. Consolidate these to reduce storage and improve write performance.`);
      } else {
        recommendations.push('No duplicate indexes found - indexes are well-organized!');
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Index analysis complete. No major issues detected.');
    }

    return recommendations;
  }
}

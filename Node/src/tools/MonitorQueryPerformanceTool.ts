import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';
import { getGlobalSqlPool } from '../index.js';

export class MonitorQueryPerformanceTool implements Tool {
  [key: string]: any;
  name = "monitor_query_performance";
  description = "Identifies slow-running queries and performance bottlenecks by analyzing execution statistics. Returns the most resource-intensive queries with execution count, duration, CPU time, and logical reads. Essential for performance troubleshooting.";
  inputSchema = {
    type: "object",
    properties: {
      topN: {
        type: "number",
        description: "Number of slowest queries to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
        default: 10
      },
      minDurationMs: {
        type: "number",
        description: "Minimum average execution time in milliseconds to include (default: 100)",
        minimum: 0,
        default: 100
      },
      orderBy: {
        type: "string",
        enum: ["duration", "cpu", "reads", "executions"],
        description: "Sort results by: 'duration' (avg execution time), 'cpu' (total CPU), 'reads' (logical reads), or 'executions' (execution count)",
        default: "duration"
      }
    },
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      const { topN = 10, minDurationMs = 100, orderBy = 'duration' } = params;
      
      // Validate topN
      const safeTopN = Math.min(Math.max(1, topN), 50);
      
      // Get connection pool (per-user if authenticated, global if not)
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        // Authenticated mode: use per-user pool
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[MonitorQueryPerformanceTool] Using per-user pool for ${userEmail} (OID: ${userId})`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        // Non-authenticated mode: use global pool (backward compatibility)
        console.log(`[MonitorQueryPerformanceTool] Using global pool (no authentication)`);
        const globalPool = getGlobalSqlPool();
        if (!globalPool) {
          throw new Error('Global SQL pool not available');
        }
        request = globalPool.request();
      }

      // Determine ORDER BY clause based on parameter
      let orderByClause: string;
      switch (orderBy) {
        case 'cpu':
          orderByClause = 'total_worker_time DESC';
          break;
        case 'reads':
          orderByClause = 'total_logical_reads DESC';
          break;
        case 'executions':
          orderByClause = 'execution_count DESC';
          break;
        case 'duration':
        default:
          orderByClause = 'avg_elapsed_time DESC';
      }

      // Query to find slow queries from the query stats DMV
      const query = `
        SELECT TOP (@topN)
          -- Query identification
          qs.sql_handle,
          qs.plan_handle,
          SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
            ((CASE qs.statement_end_offset
              WHEN -1 THEN DATALENGTH(qt.text)
              ELSE qs.statement_end_offset
            END - qs.statement_start_offset)/2) + 1) AS query_text,
          
          -- Execution statistics
          qs.execution_count,
          qs.total_elapsed_time / 1000000.0 AS total_elapsed_time_sec,
          (qs.total_elapsed_time / qs.execution_count) / 1000.0 AS avg_elapsed_time_ms,
          qs.min_elapsed_time / 1000.0 AS min_elapsed_time_ms,
          qs.max_elapsed_time / 1000.0 AS max_elapsed_time_ms,
          
          -- CPU statistics
          qs.total_worker_time / 1000000.0 AS total_cpu_time_sec,
          (qs.total_worker_time / qs.execution_count) / 1000.0 AS avg_cpu_time_ms,
          
          -- I/O statistics
          qs.total_logical_reads,
          qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
          qs.total_logical_writes,
          qs.total_physical_reads,
          
          -- Memory grant
          qs.total_grant_kb / 1024.0 AS total_memory_grant_mb,
          (qs.total_grant_kb / qs.execution_count) / 1024.0 AS avg_memory_grant_mb,
          
          -- Timing
          qs.creation_time,
          qs.last_execution_time,
          
          -- Database context
          DB_NAME(qt.dbid) AS database_name,
          
          -- Performance rating
          CASE
            WHEN (qs.total_elapsed_time / qs.execution_count) / 1000.0 > 5000 THEN 'CRITICAL: Avg >5sec'
            WHEN (qs.total_elapsed_time / qs.execution_count) / 1000.0 > 1000 THEN 'WARNING: Avg >1sec'
            WHEN (qs.total_elapsed_time / qs.execution_count) / 1000.0 > 500 THEN 'CAUTION: Avg >500ms'
            ELSE 'OK'
          END AS performance_status
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
        WHERE 
          -- Filter by minimum duration
          (qs.total_elapsed_time / qs.execution_count) / 1000.0 >= @minDurationMs
          -- Exclude system queries
          AND qt.text NOT LIKE '%sys.%'
          AND qt.text NOT LIKE '%INFORMATION_SCHEMA%'
          -- Ensure query text is not empty
          AND LTRIM(RTRIM(qt.text)) != ''
        ORDER BY ${orderByClause}
      `;

      request.input('topN', sql.Int, safeTopN);
      request.input('minDurationMs', sql.Float, minDurationMs);
      
      const result = await request.query(query);

      if (result.recordset.length === 0) {
        return {
          success: true,
          message: `No queries found with average duration >= ${minDurationMs}ms`,
          slow_queries: [],
          summary: {
            queries_analyzed: 0,
            filter: {
              top_n: safeTopN,
              min_duration_ms: minDurationMs,
              ordered_by: orderBy
            }
          }
        };
      }

      // Format the results
      const formattedQueries = result.recordset.map((row: any, index: number) => ({
        rank: index + 1,
        performance_status: row.performance_status,
        query_text: row.query_text.substring(0, 500) + (row.query_text.length > 500 ? '...' : ''), // Truncate long queries
        database_name: row.database_name,
        
        execution_stats: {
          execution_count: row.execution_count,
          total_elapsed_time_sec: Math.round(row.total_elapsed_time_sec * 100) / 100,
          avg_elapsed_time_ms: Math.round(row.avg_elapsed_time_ms * 100) / 100,
          min_elapsed_time_ms: Math.round(row.min_elapsed_time_ms * 100) / 100,
          max_elapsed_time_ms: Math.round(row.max_elapsed_time_ms * 100) / 100
        },
        
        cpu_stats: {
          total_cpu_time_sec: Math.round(row.total_cpu_time_sec * 100) / 100,
          avg_cpu_time_ms: Math.round(row.avg_cpu_time_ms * 100) / 100
        },
        
        io_stats: {
          total_logical_reads: row.total_logical_reads,
          avg_logical_reads: Math.round(row.avg_logical_reads),
          total_logical_writes: row.total_logical_writes,
          total_physical_reads: row.total_physical_reads
        },
        
        memory: {
          total_memory_grant_mb: Math.round(row.total_memory_grant_mb * 100) / 100,
          avg_memory_grant_mb: Math.round(row.avg_memory_grant_mb * 100) / 100
        },
        
        timing: {
          first_seen: row.creation_time,
          last_execution: row.last_execution_time
        }
      }));

      // Calculate summary statistics
      const totalExecutions = result.recordset.reduce((sum: number, row: any) => sum + row.execution_count, 0);
      const avgDuration = result.recordset.reduce((sum: number, row: any) => sum + row.avg_elapsed_time_ms, 0) / result.recordset.length;
      const criticalCount = result.recordset.filter((row: any) => row.performance_status.startsWith('CRITICAL')).length;
      const warningCount = result.recordset.filter((row: any) => row.performance_status.startsWith('WARNING')).length;

      return {
        success: true,
        message: `Found ${result.recordset.length} slow queries`,
        slow_queries: formattedQueries,
        summary: {
          queries_analyzed: result.recordset.length,
          total_executions: totalExecutions,
          avg_duration_ms: Math.round(avgDuration * 100) / 100,
          critical_queries: criticalCount,
          warning_queries: warningCount,
          filter: {
            top_n: safeTopN,
            min_duration_ms: minDurationMs,
            ordered_by: orderBy
          }
        },
        recommendations: this.generateRecommendations(result.recordset)
      };
    } catch (error: any) {
      console.error("Error monitoring query performance:", error);
      return {
        success: false,
        message: `Failed to monitor query performance: ${error.message || error}`,
      };
    }
  }

  private generateRecommendations(queries: any[]): string[] {
    const recommendations: string[] = [];

    // Check for high CPU queries
    const highCpuQueries = queries.filter(q => q.avg_cpu_time_ms > 1000);
    if (highCpuQueries.length > 0) {
      recommendations.push(`${highCpuQueries.length} queries with high CPU usage (>1sec avg). Consider query optimization or indexing.`);
    }

    // Check for high logical reads
    const highReadsQueries = queries.filter(q => q.avg_logical_reads > 100000);
    if (highReadsQueries.length > 0) {
      recommendations.push(`${highReadsQueries.length} queries with excessive logical reads. Check for missing indexes or table scans.`);
    }

    // Check for queries with high variance
    const highVarianceQueries = queries.filter(q => q.max_elapsed_time_ms > (q.avg_elapsed_time_ms * 10));
    if (highVarianceQueries.length > 0) {
      recommendations.push(`${highVarianceQueries.length} queries with high execution time variance. Consider parameter sniffing issues or inconsistent data.`);
    }

    // Check for frequently executed slow queries
    const frequentSlowQueries = queries.filter(q => q.execution_count > 1000 && q.avg_elapsed_time_ms > 100);
    if (frequentSlowQueries.length > 0) {
      recommendations.push(`${frequentSlowQueries.length} frequently executed slow queries. These should be top priority for optimization.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Query performance appears within acceptable ranges. Continue monitoring for trends.');
    }

    return recommendations;
  }
}

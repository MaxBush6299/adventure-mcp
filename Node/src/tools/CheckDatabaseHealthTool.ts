import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolContext, isValidAuthContext } from './ToolContext.js';
import { getGlobalSqlPool } from '../index.js';

export class CheckDatabaseHealthTool implements Tool {
  [key: string]: any;
  name = "check_database_health";
  description = "Performs a comprehensive database health check including size, growth, backup status, log usage, recovery model, and database state. Essential for monitoring database health and compliance.";
  inputSchema = {
    type: "object",
    properties: {},
    required: [],
  } as any;

  async run(params: any, context?: ToolContext) {
    try {
      // Get connection pool (per-user if authenticated, global if not)
      let request: sql.Request;
      
      if (isValidAuthContext(context) && context) {
        // Authenticated mode: use per-user pool
        const userId = context.userIdentity.oid || context.userIdentity.userId;
        const userEmail = context.userIdentity.email || context.userIdentity.upn;
        console.log(`[CheckDatabaseHealthTool] Using per-user pool for ${userEmail} (OID: ${userId})`);
        
        const pool = await context.poolManager.getPoolForUser(
          userId,
          context.userIdentity.sqlToken!,
          context.userIdentity.tokenExpiry!
        );
        request = pool.request();
      } else {
        // Non-authenticated mode: use global pool (backward compatibility)
        console.log(`[CheckDatabaseHealthTool] Using global pool (no authentication)`);
        const globalPool = getGlobalSqlPool();
        if (!globalPool) {
          throw new Error('Global SQL pool not available');
        }
        request = globalPool.request();
      }

      // Comprehensive health check query
      const query = `
        -- Database size and space usage
        DECLARE @DatabaseSize TABLE (
          database_name NVARCHAR(128),
          size_mb DECIMAL(18,2),
          unallocated_space_mb DECIMAL(18,2),
          reserved_mb DECIMAL(18,2),
          data_mb DECIMAL(18,2),
          index_size_mb DECIMAL(18,2),
          unused_mb DECIMAL(18,2)
        );

        INSERT INTO @DatabaseSize
        EXEC sp_spaceused @updateusage = 'TRUE';

        -- Get database properties
        SELECT 
          -- Basic Info
          DB_NAME() AS database_name,
          DATABASEPROPERTYEX(DB_NAME(), 'Status') AS database_state,
          DATABASEPROPERTYEX(DB_NAME(), 'Recovery') AS recovery_model,
          DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS collation,
          DATABASEPROPERTYEX(DB_NAME(), 'IsAutoClose') AS auto_close,
          DATABASEPROPERTYEX(DB_NAME(), 'IsAutoShrink') AS auto_shrink,
          
          -- Size and Space
          (SELECT size_mb FROM @DatabaseSize) AS total_size_mb,
          (SELECT unallocated_space_mb FROM @DatabaseSize) AS unallocated_space_mb,
          (SELECT data_mb FROM @DatabaseSize) AS data_used_mb,
          (SELECT index_size_mb FROM @DatabaseSize) AS index_used_mb,
          (SELECT unused_mb FROM @DatabaseSize) AS unused_mb,
          
          -- File Information
          (SELECT COUNT(*) FROM sys.master_files WHERE database_id = DB_ID() AND type = 0) AS data_files_count,
          (SELECT COUNT(*) FROM sys.master_files WHERE database_id = DB_ID() AND type = 1) AS log_files_count,
          (SELECT SUM(size) * 8 / 1024.0 FROM sys.master_files WHERE database_id = DB_ID() AND type = 1) AS log_size_mb,
          (SELECT SUM(CAST(FILEPROPERTY(name, 'SpaceUsed') AS BIGINT)) * 8 / 1024.0 FROM sys.database_files WHERE type = 1) AS log_used_mb,
          
          -- Auto-growth settings
          (SELECT TOP 1 
            CASE 
              WHEN is_percent_growth = 1 THEN CAST(growth AS VARCHAR(10)) + '%'
              ELSE CAST(growth * 8 / 1024 AS VARCHAR(10)) + ' MB'
            END
          FROM sys.master_files 
          WHERE database_id = DB_ID() AND type = 0) AS data_file_growth,
          
          (SELECT TOP 1 
            CASE 
              WHEN is_percent_growth = 1 THEN CAST(growth AS VARCHAR(10)) + '%'
              ELSE CAST(growth * 8 / 1024 AS VARCHAR(10)) + ' MB'
            END
          FROM sys.master_files 
          WHERE database_id = DB_ID() AND type = 1) AS log_file_growth,
          
          -- Backup Information
          (SELECT MAX(backup_finish_date) 
           FROM msdb.dbo.backupset 
           WHERE database_name = DB_NAME() AND type = 'D') AS last_full_backup,
          
          (SELECT MAX(backup_finish_date) 
           FROM msdb.dbo.backupset 
           WHERE database_name = DB_NAME() AND type = 'I') AS last_differential_backup,
          
          (SELECT MAX(backup_finish_date) 
           FROM msdb.dbo.backupset 
           WHERE database_name = DB_NAME() AND type = 'L') AS last_log_backup,
          
          -- Days since last full backup
          DATEDIFF(DAY, 
            (SELECT MAX(backup_finish_date) 
             FROM msdb.dbo.backupset 
             WHERE database_name = DB_NAME() AND type = 'D'), 
            GETDATE()) AS days_since_full_backup,
          
          -- Database creation and last modification
          (SELECT create_date FROM sys.databases WHERE name = DB_NAME()) AS database_created_date,
          
          -- Compatibility level
          DATABASEPROPERTYEX(DB_NAME(), 'Version') AS compatibility_level,
          
          -- Health Status Assessment
          CASE 
            WHEN DATABASEPROPERTYEX(DB_NAME(), 'Status') != 'ONLINE' THEN 'CRITICAL: Database is not online'
            WHEN DATEDIFF(DAY, (SELECT MAX(backup_finish_date) FROM msdb.dbo.backupset WHERE database_name = DB_NAME() AND type = 'D'), GETDATE()) > 7 
              THEN 'WARNING: No full backup in 7+ days'
            WHEN (SELECT SUM(CAST(FILEPROPERTY(name, 'SpaceUsed') AS BIGINT)) * 100.0 / SUM(size) FROM sys.database_files WHERE type = 1) > 80
              THEN 'WARNING: Transaction log is over 80% full'
            WHEN (SELECT unallocated_space_mb FROM @DatabaseSize) < 100
              THEN 'WARNING: Less than 100 MB unallocated space'
            ELSE 'OK: Database appears healthy'
          END AS health_status,
          
          -- Recommendations
          CASE 
            WHEN DATABASEPROPERTYEX(DB_NAME(), 'IsAutoShrink') = 1 
              THEN 'Consider disabling Auto Shrink (causes fragmentation). '
            ELSE ''
          END +
          CASE 
            WHEN DATEDIFF(DAY, (SELECT MAX(backup_finish_date) FROM msdb.dbo.backupset WHERE database_name = DB_NAME() AND type = 'D'), GETDATE()) > 7 
              THEN 'Schedule regular full backups. '
            ELSE ''
          END +
          CASE 
            WHEN (SELECT SUM(CAST(FILEPROPERTY(name, 'SpaceUsed') AS BIGINT)) * 100.0 / SUM(size) FROM sys.database_files WHERE type = 1) > 80
              THEN 'Transaction log is filling up - consider log backup or increase log size. '
            ELSE ''
          END AS recommendations
      `;

      const result = await request.query(query);
      
      if (result.recordset.length === 0) {
        return {
          success: false,
          message: "Failed to retrieve database health information"
        };
      }

      const healthInfo = result.recordset[0];

      return {
        success: true,
        message: "Database health check completed successfully",
        health_check: {
          database_name: healthInfo.database_name,
          status: healthInfo.database_state,
          health_status: healthInfo.health_status,
          
          size_and_space: {
            total_size_mb: Math.round(healthInfo.total_size_mb * 100) / 100,
            unallocated_space_mb: Math.round(healthInfo.unallocated_space_mb * 100) / 100,
            data_used_mb: Math.round(healthInfo.data_used_mb * 100) / 100,
            index_used_mb: Math.round(healthInfo.index_used_mb * 100) / 100,
            unused_mb: Math.round(healthInfo.unused_mb * 100) / 100,
            data_files_count: healthInfo.data_files_count,
            data_file_growth: healthInfo.data_file_growth
          },
          
          transaction_log: {
            log_files_count: healthInfo.log_files_count,
            log_size_mb: Math.round(healthInfo.log_size_mb * 100) / 100,
            log_used_mb: Math.round(healthInfo.log_used_mb * 100) / 100,
            log_used_percent: healthInfo.log_size_mb > 0 ? 
              Math.round((healthInfo.log_used_mb / healthInfo.log_size_mb) * 10000) / 100 : 0,
            log_file_growth: healthInfo.log_file_growth
          },
          
          backup_status: {
            last_full_backup: healthInfo.last_full_backup,
            last_differential_backup: healthInfo.last_differential_backup,
            last_log_backup: healthInfo.last_log_backup,
            days_since_full_backup: healthInfo.days_since_full_backup
          },
          
          configuration: {
            recovery_model: healthInfo.recovery_model,
            auto_close: healthInfo.auto_close === 1 ? 'Enabled' : 'Disabled',
            auto_shrink: healthInfo.auto_shrink === 1 ? 'Enabled' : 'Disabled',
            compatibility_level: healthInfo.compatibility_level,
            collation: healthInfo.collation,
            created_date: healthInfo.database_created_date
          },
          
          recommendations: healthInfo.recommendations || 'No recommendations at this time'
        }
      };
    } catch (error: any) {
      console.error("Error checking database health:", error);
      return {
        success: false,
        message: `Failed to check database health: ${error.message || error}`,
      };
    }
  }
}

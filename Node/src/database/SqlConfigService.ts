/**
 * SQL Configuration Service
 * 
 * Creates SQL configurations for per-user connections using OBO tokens.
 */

import sql from "mssql";
import { TokenExchangeService } from "./TokenExchangeService.js";

/**
 * SQL configuration with token and expiry information
 */
export interface SqlConfigResult {
  config: sql.config;
  sqlToken: string;
  expiresOn: Date;
  userId: string;
}

/**
 * Configuration for SQL connection
 */
export interface SqlConnectionConfig {
  serverName: string;
  databaseName: string;
  trustServerCertificate?: boolean;
  connectionTimeout?: number;
}

/**
 * Service for creating SQL configurations with OBO authentication
 */
export class SqlConfigService {
  private tokenExchangeService: TokenExchangeService;
  private sqlConfig: SqlConnectionConfig;

  constructor(
    tokenExchangeService: TokenExchangeService,
    sqlConfig: SqlConnectionConfig
  ) {
    this.tokenExchangeService = tokenExchangeService;
    this.sqlConfig = sqlConfig;

    console.log('[SqlConfig] Service initialized');
    console.log(`[SqlConfig] Server: ${sqlConfig.serverName}`);
    console.log(`[SqlConfig] Database: ${sqlConfig.databaseName}`);
  }

  /**
   * Create SQL configuration for a specific user
   * 
   * @param userToken - User's access token from MCP client
   * @param userId - User's unique identifier (OID)
   * @returns SQL configuration with user's SQL-scoped token
   */
  async createConfigForUser(
    userToken: string,
    userId: string
  ): Promise<SqlConfigResult> {
    console.log(`[SqlConfig] Creating SQL config for user ${userId}`);

    try {
      // Exchange user token for SQL-scoped token
      const sqlToken = await this.tokenExchangeService.getSqlToken(userToken, userId);

      // Create SQL configuration with access token authentication
      const config: sql.config = {
        server: this.sqlConfig.serverName,
        database: this.sqlConfig.databaseName,
        port: 1433,
        options: {
          encrypt: true,
          trustServerCertificate: this.sqlConfig.trustServerCertificate ?? false,
          enableArithAbort: true
        },
        authentication: {
          type: 'azure-active-directory-access-token',
          options: {
            token: sqlToken
          }
        },
        connectionTimeout: (this.sqlConfig.connectionTimeout ?? 30) * 1000
      };

      // Note: expiresOn is managed by TokenExchangeService, we approximate here
      const expiresOn = new Date(Date.now() + 3600 * 1000); // 1 hour default

      console.log(`[SqlConfig] SQL config created for user ${userId}`);

      return {
        config,
        sqlToken,
        expiresOn,
        userId
      };

    } catch (error: any) {
      console.error(`[SqlConfig] Failed to create config for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate a user's token (forces refresh on next request)
   */
  invalidateUserToken(userId: string): void {
    this.tokenExchangeService.invalidateToken(userId);
  }

  /**
   * Get token exchange statistics
   */
  getStats() {
    return this.tokenExchangeService.getStats();
  }

  /**
   * Clean up expired tokens
   */
  cleanupExpiredTokens(): number {
    return this.tokenExchangeService.cleanupExpiredTokens();
  }
}

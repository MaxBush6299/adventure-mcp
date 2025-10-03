/**
 * Connection Pool Manager
 * 
 * Manages per-user SQL connection pools for row-level security.
 * Each user gets their own dedicated connection pool that uses their
 * access token for authentication. Pools are automatically cleaned up
 * after periods of inactivity to manage resources efficiently.
 * 
 * Features:
 * - Per-user connection pool isolation
 * - Automatic idle timeout and cleanup
 * - Token expiration detection and pool invalidation
 * - Max concurrent users enforcement
 * - Comprehensive metrics and statistics
 * - Memory-efficient pool management
 */

import sql from 'mssql';

/**
 * Configuration for connection pool management
 */
export interface PoolManagerConfig {
  /** Maximum number of concurrent user pools allowed */
  maxUsers: number;
  /** Time in milliseconds before an idle pool is closed */
  idleTimeout: number;
  /** Interval in milliseconds for running cleanup operations */
  cleanupInterval: number;
  /** Buffer time in milliseconds before token expiry to refresh */
  tokenRefreshBuffer: number;
  /** SQL Server connection settings */
  sqlConfig: {
    server: string;
    database: string;
    port: number;
    trustServerCertificate: boolean;
    connectionTimeout: number;
  };
}

/**
 * Metadata for a user's connection pool
 */
interface PoolMetadata {
  /** The SQL connection pool instance */
  pool: sql.ConnectionPool;
  /** Last time this pool was accessed */
  lastUsed: Date;
  /** When the access token expires */
  tokenExpiresOn: Date;
  /** User identifier */
  userId: string;
  /** Number of times this pool has been used */
  accessCount: number;
}

/**
 * Statistics about pool manager health
 */
export interface PoolStats {
  /** Number of currently active pools */
  activePools: number;
  /** Total number of connections across all pools */
  totalConnections: number;
  /** Number of pools created since startup */
  poolsCreated: number;
  /** Number of pools closed since startup */
  poolsClosed: number;
  /** Number of pools closed due to idle timeout */
  poolsClosedIdle: number;
  /** Number of pools closed due to token expiration */
  poolsClosedExpired: number;
  /** Number of times getPoolForUser was called */
  poolRequests: number;
  /** Number of times existing pool was reused */
  poolHits: number;
  /** Number of times new pool was created */
  poolMisses: number;
  /** Number of times max users limit was reached */
  maxUsersReached: number;
  /** List of currently active user IDs */
  activeUsers: string[];
}

/**
 * Manages per-user SQL connection pools with automatic lifecycle management
 */
export class ConnectionPoolManager {
  private pools: Map<string, PoolMetadata>;
  private config: PoolManagerConfig;
  private cleanupTimer: NodeJS.Timeout | null;
  private stats: PoolStats;

  constructor(config: PoolManagerConfig) {
    this.pools = new Map();
    this.config = config;
    this.cleanupTimer = null;
    
    // Initialize statistics
    this.stats = {
      activePools: 0,
      totalConnections: 0,
      poolsCreated: 0,
      poolsClosed: 0,
      poolsClosedIdle: 0,
      poolsClosedExpired: 0,
      poolRequests: 0,
      poolHits: 0,
      poolMisses: 0,
      maxUsersReached: 0,
      activeUsers: []
    };

    console.log('[PoolManager] Connection Pool Manager initialized');
    console.log(`[PoolManager] Config: maxUsers=${config.maxUsers}, idleTimeout=${config.idleTimeout}ms, cleanupInterval=${config.cleanupInterval}ms`);
  }

  /**
   * Starts the periodic cleanup timer
   */
  public startCleanup(): void {
    if (this.cleanupTimer) {
      console.log('[PoolManager] Cleanup timer already running');
      return;
    }

    console.log(`[PoolManager] Starting periodic cleanup (interval: ${this.config.cleanupInterval}ms)`);
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupIdlePools();
    }, this.config.cleanupInterval);

    // Don't prevent Node.js from exiting
    this.cleanupTimer.unref();
  }

  /**
   * Stops the periodic cleanup timer
   */
  public stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[PoolManager] Cleanup timer stopped');
    }
  }

  /**
   * Gets or creates a connection pool for a specific user
   * 
   * @param userId - Unique identifier for the user (e.g., OID from token)
   * @param sqlToken - SQL-scoped access token for the user
   * @param tokenExpiresOn - When the token expires
   * @returns SQL connection pool for the user
   * @throws Error if max users limit reached or pool creation fails
   */
  public async getPoolForUser(
    userId: string,
    sqlToken: string,
    tokenExpiresOn: Date
  ): Promise<sql.ConnectionPool> {
    this.stats.poolRequests++;

    // Check if pool already exists and is valid
    const existing = this.pools.get(userId);
    if (existing) {
      // Check if token is still valid (with buffer)
      const now = new Date();
      const timeUntilExpiry = existing.tokenExpiresOn.getTime() - now.getTime();
      
      if (timeUntilExpiry > this.config.tokenRefreshBuffer) {
        // Pool is valid, update last used time
        existing.lastUsed = now;
        existing.accessCount++;
        this.stats.poolHits++;
        
        console.log(`[PoolManager] Reusing pool for user ${userId} (hits: ${this.stats.poolHits}, access count: ${existing.accessCount})`);
        return existing.pool;
      } else {
        // Token is expired or about to expire, close old pool
        console.log(`[PoolManager] Token expired or expiring soon for user ${userId}, closing old pool`);
        await this.closePool(userId, 'expired');
      }
    }

    // Need to create new pool - check max users limit
    if (this.pools.size >= this.config.maxUsers) {
      this.stats.maxUsersReached++;
      console.error(`[PoolManager] Max users limit reached (${this.config.maxUsers}), cannot create pool for user ${userId}`);
      throw new Error(`Maximum concurrent users (${this.config.maxUsers}) reached. Please try again later.`);
    }

    // Create new pool
    this.stats.poolMisses++;
    console.log(`[PoolManager] Creating new pool for user ${userId} (misses: ${this.stats.poolMisses})`);
    
    const pool = await this.createPool(userId, sqlToken, tokenExpiresOn);
    
    return pool;
  }

  /**
   * Creates a new SQL connection pool for a user
   * 
   * @param userId - User identifier
   * @param sqlToken - SQL-scoped access token
   * @param tokenExpiresOn - Token expiration time
   * @returns Newly created connection pool
   */
  private async createPool(
    userId: string,
    sqlToken: string,
    tokenExpiresOn: Date
  ): Promise<sql.ConnectionPool> {
    const config: sql.config = {
      server: this.config.sqlConfig.server,
      database: this.config.sqlConfig.database,
      port: this.config.sqlConfig.port,
      options: {
        encrypt: true,
        trustServerCertificate: this.config.sqlConfig.trustServerCertificate,
        enableArithAbort: true,
      },
      authentication: {
        type: 'azure-active-directory-access-token',
        options: {
          token: sqlToken,
        },
      },
      connectionTimeout: this.config.sqlConfig.connectionTimeout * 1000,
      // Pool configuration
      pool: {
        max: 10,  // Max connections per user pool
        min: 1,   // Keep at least 1 connection warm
        idleTimeoutMillis: 30000, // Close idle connections after 30s
      },
    };

    const pool = new sql.ConnectionPool(config);

    try {
      console.log(`[PoolManager] Connecting pool for user ${userId}...`);
      await pool.connect();
      console.log(`[PoolManager] Pool connected successfully for user ${userId}`);

      // Store pool metadata
      const metadata: PoolMetadata = {
        pool,
        lastUsed: new Date(),
        tokenExpiresOn,
        userId,
        accessCount: 1,
      };

      this.pools.set(userId, metadata);
      this.stats.poolsCreated++;
      this.stats.activePools = this.pools.size;
      this.updateActiveUsers();

      console.log(`[PoolManager] Pool created for user ${userId} (total active pools: ${this.stats.activePools})`);

      // Set up error handlers
      pool.on('error', (err) => {
        console.error(`[PoolManager] Pool error for user ${userId}:`, err);
        // Close the pool on error
        this.closePool(userId, 'error').catch(e => 
          console.error(`[PoolManager] Failed to close pool after error:`, e)
        );
      });

      return pool;
    } catch (error) {
      console.error(`[PoolManager] Failed to create pool for user ${userId}:`, error);
      
      // Clean up failed pool
      try {
        await pool.close();
      } catch (closeError) {
        console.error(`[PoolManager] Error closing failed pool:`, closeError);
      }
      
      throw new Error(`Failed to create database connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Closes a specific user's connection pool
   * 
   * @param userId - User identifier
   * @param reason - Reason for closing (for logging)
   */
  public async closePool(userId: string, reason: 'idle' | 'expired' | 'manual' | 'error' = 'manual'): Promise<void> {
    const metadata = this.pools.get(userId);
    if (!metadata) {
      console.log(`[PoolManager] No pool found for user ${userId}`);
      return;
    }

    console.log(`[PoolManager] Closing pool for user ${userId} (reason: ${reason})`);

    try {
      await metadata.pool.close();
      this.pools.delete(userId);
      
      this.stats.poolsClosed++;
      if (reason === 'idle') {
        this.stats.poolsClosedIdle++;
      } else if (reason === 'expired') {
        this.stats.poolsClosedExpired++;
      }
      
      this.stats.activePools = this.pools.size;
      this.updateActiveUsers();

      console.log(`[PoolManager] Pool closed for user ${userId} (total active pools: ${this.stats.activePools})`);
    } catch (error) {
      console.error(`[PoolManager] Error closing pool for user ${userId}:`, error);
      // Remove from map anyway
      this.pools.delete(userId);
      this.stats.activePools = this.pools.size;
      this.updateActiveUsers();
    }
  }

  /**
   * Cleans up idle and expired pools
   * Called periodically by the cleanup timer
   */
  public async cleanupIdlePools(): Promise<void> {
    const now = new Date();
    const poolsToClose: string[] = [];

    // Find pools that need cleanup
    for (const [userId, metadata] of this.pools.entries()) {
      const idleTime = now.getTime() - metadata.lastUsed.getTime();
      const timeUntilExpiry = metadata.tokenExpiresOn.getTime() - now.getTime();

      if (timeUntilExpiry <= 0) {
        console.log(`[PoolManager] Pool for user ${userId} has expired token, marking for cleanup`);
        poolsToClose.push(userId);
      } else if (idleTime >= this.config.idleTimeout) {
        console.log(`[PoolManager] Pool for user ${userId} has been idle for ${Math.round(idleTime / 1000)}s, marking for cleanup`);
        poolsToClose.push(userId);
      }
    }

    // Close marked pools
    if (poolsToClose.length > 0) {
      console.log(`[PoolManager] Cleaning up ${poolsToClose.length} idle/expired pools`);
      
      for (const userId of poolsToClose) {
        const metadata = this.pools.get(userId);
        const reason = metadata && metadata.tokenExpiresOn.getTime() <= now.getTime() ? 'expired' : 'idle';
        await this.closePool(userId, reason);
      }
    }
  }

  /**
   * Closes all connection pools
   * Should be called during application shutdown
   */
  public async closeAllPools(): Promise<void> {
    console.log(`[PoolManager] Closing all connection pools (${this.pools.size} active)`);
    
    this.stopCleanup();

    const closePromises: Promise<void>[] = [];
    for (const userId of this.pools.keys()) {
      closePromises.push(this.closePool(userId, 'manual'));
    }

    await Promise.all(closePromises);
    console.log('[PoolManager] All pools closed');
  }

  /**
   * Gets current pool manager statistics
   */
  public getPoolStats(): PoolStats {
    return {
      ...this.stats,
      activePools: this.pools.size,
    };
  }

  /**
   * Gets detailed information about a specific user's pool
   */
  public getPoolInfo(userId: string): {
    exists: boolean;
    lastUsed?: Date;
    tokenExpiresOn?: Date;
    accessCount?: number;
    idleTime?: number;
    timeUntilExpiry?: number;
  } {
    const metadata = this.pools.get(userId);
    if (!metadata) {
      return { exists: false };
    }

    const now = new Date();
    return {
      exists: true,
      lastUsed: metadata.lastUsed,
      tokenExpiresOn: metadata.tokenExpiresOn,
      accessCount: metadata.accessCount,
      idleTime: now.getTime() - metadata.lastUsed.getTime(),
      timeUntilExpiry: metadata.tokenExpiresOn.getTime() - now.getTime(),
    };
  }

  /**
   * Updates the list of active users in stats
   */
  private updateActiveUsers(): void {
    this.stats.activeUsers = Array.from(this.pools.keys());
  }

  /**
   * Gets the number of currently active pools
   */
  public getActivePoolCount(): number {
    return this.pools.size;
  }

  /**
   * Checks if a user has an active pool
   */
  public hasPool(userId: string): boolean {
    return this.pools.has(userId);
  }
}

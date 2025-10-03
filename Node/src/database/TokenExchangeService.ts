/**
 * OBO Token Exchange Service
 * 
 * Implements On-Behalf-Of (OBO) flow to exchange user tokens for SQL-scoped tokens.
 * Caches tokens per user with automatic refresh logic.
 */

import { OnBehalfOfCredential } from "@azure/identity";

/**
 * Configuration for token exchange
 */
export interface TokenExchangeConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sqlScope?: string;
  tokenRefreshBuffer?: number; // milliseconds before expiry to refresh
}

/**
 * Cached token information
 */
interface CachedToken {
  sqlToken: string;
  expiresOn: Date;
  userId: string;
}

/**
 * Statistics for monitoring
 */
export interface TokenExchangeStats {
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  exchangeSuccesses: number;
  exchangeFailures: number;
  refreshCount: number;
}

/**
 * Service for exchanging user tokens for SQL-scoped tokens using OBO flow
 */
export class TokenExchangeService {
  private config: TokenExchangeConfig;
  private tokenCache: Map<string, CachedToken>;
  private stats: TokenExchangeStats;

  // Default: refresh tokens 5 minutes before expiry
  private readonly DEFAULT_REFRESH_BUFFER = 5 * 60 * 1000;
  // Default SQL scope
  private readonly DEFAULT_SQL_SCOPE = 'https://database.windows.net/.default';

  constructor(config: TokenExchangeConfig) {
    this.config = {
      ...config,
      sqlScope: config.sqlScope || this.DEFAULT_SQL_SCOPE,
      tokenRefreshBuffer: config.tokenRefreshBuffer || this.DEFAULT_REFRESH_BUFFER
    };

    this.tokenCache = new Map();
    this.stats = {
      cacheSize: 0,
      cacheHits: 0,
      cacheMisses: 0,
      exchangeSuccesses: 0,
      exchangeFailures: 0,
      refreshCount: 0
    };

    console.log('[TokenExchange] Service initialized');
    console.log(`[TokenExchange] SQL Scope: ${this.config.sqlScope}`);
    console.log(`[TokenExchange] Refresh Buffer: ${this.config.tokenRefreshBuffer! / 1000}s`);
  }

  /**
   * Get SQL-scoped token for a user
   * Uses cached token if valid, otherwise performs OBO exchange
   * 
   * @param userToken - User's access token (from MCP client)
   * @param userId - User's unique identifier (OID)
   * @returns SQL-scoped access token
   */
  async getSqlToken(userToken: string, userId: string): Promise<string> {
    // Check cache first
    const cached = this.tokenCache.get(userId);
    
    if (cached && this.isTokenValid(cached)) {
      this.stats.cacheHits++;
      console.log(`[TokenExchange] Cache HIT for user ${userId} (expires: ${cached.expiresOn.toISOString()})`);
      return cached.sqlToken;
    }

    // Check if token already has SQL Database audience (testing scenario)
    // In production, this should always go through OBO
    const tokenAudience = this.getTokenAudience(userToken);
    if (tokenAudience === 'https://database.windows.net/' || tokenAudience === 'https://database.windows.net') {
      console.log(`[TokenExchange] Token already has SQL Database audience - skipping OBO (testing mode)`);
      
      // Parse expiry from token
      const expiresOn = this.getTokenExpiry(userToken);
      
      // Cache it
      this.cacheToken(userId, userToken, expiresOn);
      this.stats.exchangeSuccesses++;
      
      return userToken;
    }

    // Cache miss or expired - perform OBO exchange
    this.stats.cacheMisses++;
    console.log(`[TokenExchange] Cache MISS for user ${userId} - performing OBO exchange`);

    try {
      const sqlToken = await this.performOboExchange(userToken, userId);
      this.stats.exchangeSuccesses++;
      return sqlToken;
    } catch (error: any) {
      this.stats.exchangeFailures++;
      console.error(`[TokenExchange] OBO exchange failed for user ${userId}:`, error.message);
      throw new Error(`Failed to exchange token for SQL access: ${error.message}`);
    }
  }

  /**
   * Get SQL-scoped token with expiry information for a user
   * Uses cached token if valid, otherwise performs OBO exchange
   * 
   * @param userToken - User's access token (from MCP client)
   * @param userId - User's unique identifier (OID)
   * @returns Object with SQL token and expiry date
   */
  async getSqlTokenWithExpiry(userToken: string, userId: string): Promise<{ token: string; expiresOn: Date }> {
    // Get the token (this will cache it if needed)
    const token = await this.getSqlToken(userToken, userId);
    
    // Get from cache to retrieve expiry
    const cached = this.tokenCache.get(userId);
    if (!cached) {
      // Should not happen, but provide a default
      return {
        token,
        expiresOn: new Date(Date.now() + 3600 * 1000) // Default 1 hour
      };
    }
    
    return {
      token: cached.sqlToken,
      expiresOn: cached.expiresOn
    };
  }

  /**
   * Perform OBO token exchange
   */
  private async performOboExchange(userToken: string, userId: string): Promise<string> {
    console.log(`[TokenExchange] Starting OBO flow for user ${userId}`);
    console.log(`[TokenExchange] Requesting scope: ${this.config.sqlScope}`);

    // Create OBO credential
    const oboCredential = new OnBehalfOfCredential({
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      userAssertionToken: userToken
    });

    try {
      // Exchange for SQL-scoped token
      // Note: Use .default scope format for Azure SQL Database
      const tokenResponse = await oboCredential.getToken([this.config.sqlScope!]);

      if (!tokenResponse || !tokenResponse.token) {
        throw new Error('OBO exchange returned empty token');
      }

      const expiresOn = tokenResponse.expiresOnTimestamp 
        ? new Date(tokenResponse.expiresOnTimestamp)
        : new Date(Date.now() + 3600 * 1000); // Default 1 hour

      console.log(`[TokenExchange] OBO exchange SUCCESS for user ${userId}`);
      console.log(`[TokenExchange] SQL token expires: ${expiresOn.toISOString()}`);
      console.log(`[TokenExchange] Token length: ${tokenResponse.token.length} characters`);

      // Cache the token
      this.cacheToken(userId, tokenResponse.token, expiresOn);

      return tokenResponse.token;

    } catch (error: any) {
      console.error(`[TokenExchange] OBO credential error:`, error);
      
      // Provide helpful error messages
      if (error.message?.includes('AADSTS50013')) {
        throw new Error('Invalid user token - token may be expired or malformed');
      }
      if (error.message?.includes('AADSTS65001')) {
        throw new Error('User has not consented to the application');
      }
      if (error.message?.includes('AADSTS70011')) {
        throw new Error('Invalid scope for SQL Database');
      }

      throw error;
    }
  }

  /**
   * Cache a token for a user
   */
  private cacheToken(userId: string, sqlToken: string, expiresOn: Date): void {
    const cached: CachedToken = {
      sqlToken,
      expiresOn,
      userId
    };

    this.tokenCache.set(userId, cached);
    this.stats.cacheSize = this.tokenCache.size;

    console.log(`[TokenExchange] Cached token for user ${userId} (cache size: ${this.stats.cacheSize})`);
  }

  /**
   * Get token audience from JWT (for testing/debugging)
   */
  private getTokenAudience(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.aud || null;
    } catch {
      return null;
    }
  }

  /**
   * Get token expiry from JWT
   */
  private getTokenExpiry(token: string): Date {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return new Date(Date.now() + 3600 * 1000); // Default 1 hour
      }
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.exp) {
        return new Date(payload.exp * 1000);
      }
      return new Date(Date.now() + 3600 * 1000); // Default 1 hour
    } catch {
      return new Date(Date.now() + 3600 * 1000); // Default 1 hour
    }
  }

  /**
   * Check if cached token is still valid
   * Returns false if token expires within refresh buffer
   */
  private isTokenValid(cached: CachedToken): boolean {
    const now = Date.now();
    const expiresOn = cached.expiresOn.getTime();
    const buffer = this.config.tokenRefreshBuffer!;

    // Token is valid if it expires AFTER (now + buffer)
    const isValid = expiresOn > (now + buffer);

    if (!isValid && expiresOn > now) {
      console.log(`[TokenExchange] Token for user ${cached.userId} expires soon, will refresh`);
      this.stats.refreshCount++;
    }

    return isValid;
  }

  /**
   * Manually invalidate a user's cached token
   * Useful for forcing refresh or on logout
   */
  invalidateToken(userId: string): void {
    const deleted = this.tokenCache.delete(userId);
    if (deleted) {
      this.stats.cacheSize = this.tokenCache.size;
      console.log(`[TokenExchange] Invalidated token for user ${userId}`);
    }
  }

  /**
   * Clean up expired tokens from cache
   * Should be called periodically
   */
  cleanupExpiredTokens(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, cached] of this.tokenCache.entries()) {
      if (cached.expiresOn.getTime() <= now) {
        this.tokenCache.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.stats.cacheSize = this.tokenCache.size;
      console.log(`[TokenExchange] Cleaned up ${cleaned} expired tokens (cache size: ${this.stats.cacheSize})`);
    }

    return cleaned;
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats(): TokenExchangeStats {
    return { ...this.stats };
  }

  /**
   * Clear all cached tokens
   * Useful for testing or emergency situations
   */
  clearCache(): void {
    const size = this.tokenCache.size;
    this.tokenCache.clear();
    this.stats.cacheSize = 0;
    console.log(`[TokenExchange] Cleared cache (${size} tokens removed)`);
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.tokenCache.size;
  }
}

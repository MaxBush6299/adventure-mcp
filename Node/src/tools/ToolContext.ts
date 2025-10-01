import { ConnectionPoolManager } from '../database/ConnectionPoolManager.js';
import { UserIdentity as AuthUserIdentity } from '../auth/types.js';

/**
 * Extended user identity with SQL-specific tokens for tool execution
 */
export interface ToolUserIdentity extends AuthUserIdentity {
  /** SQL token obtained via OBO flow */
  sqlToken?: string;
  
  /** SQL token expiry date */
  tokenExpiry?: Date;
  
  /** User's Object ID (OID) - alias for userId for convenience */
  oid?: string;
}

/**
 * Context passed to every tool execution containing user identity and connection pool manager.
 * This enables per-user SQL connections with automatic RLS enforcement.
 */
export interface ToolContext {
  /**
   * The authenticated user's identity information with SQL tokens
   */
  userIdentity: ToolUserIdentity;
  
  /**
   * Connection pool manager for obtaining per-user SQL connections
   */
  poolManager: ConnectionPoolManager;
  
  /**
   * Optional: Additional metadata for future extensibility
   */
  metadata?: Record<string, any>;
}

/**
 * Helper function to check if authentication is required
 * @returns true if REQUIRE_AUTH environment variable is set to 'true'
 */
export function isAuthRequired(): boolean {
  return process.env.REQUIRE_AUTH === 'true';
}

/**
 * Helper function to check if a ToolContext has all required properties for authenticated execution
 * @param context The ToolContext to validate
 * @returns true if context has userIdentity, poolManager, and SQL token
 */
export function isValidAuthContext(context?: ToolContext): boolean {
  return !!(
    context?.userIdentity &&
    context?.poolManager &&
    context?.userIdentity.sqlToken
  );
}

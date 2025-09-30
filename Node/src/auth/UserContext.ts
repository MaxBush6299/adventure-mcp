/**
 * User Context Management
 * 
 * Manages user identity throughout request lifecycle.
 * Provides thread-safe access to current user information.
 */

import { UserIdentity } from './types.js';

/**
 * Context holder for user identity during request processing
 * 
 * In Express, this is attached to the request object.
 * For MCP tools, this is passed as a parameter.
 */
export class UserContext {
  constructor(public readonly user: UserIdentity) {}

  /**
   * Get user's unique identifier (OID)
   */
  getUserId(): string {
    return this.user.userId;
  }

  /**
   * Get user's principal name (typically email)
   */
  getUPN(): string {
    return this.user.upn;
  }

  /**
   * Get user's display name
   */
  getName(): string {
    return this.user.name || this.user.upn;
  }

  /**
   * Get the original access token (needed for OBO flow)
   */
  getAccessToken(): string {
    return this.user.accessToken;
  }

  /**
   * Check if user belongs to a specific group (by OID)
   */
  hasGroup(groupId: string): boolean {
    return this.user.groups?.includes(groupId) || false;
  }

  /**
   * Check if user has a specific role
   */
  hasRole(role: string): boolean {
    return this.user.roles?.includes(role) || false;
  }

  /**
   * Get tenant ID
   */
  getTenantId(): string {
    return this.user.tenantId;
  }

  /**
   * Get all user groups
   */
  getGroups(): string[] {
    return this.user.groups || [];
  }

  /**
   * Get all user roles
   */
  getRoles(): string[] {
    return this.user.roles || [];
  }

  /**
   * Get a specific claim from the token
   */
  getClaim(claimName: string): any {
    return this.user.claims[claimName];
  }

  /**
   * Get all claims
   */
  getAllClaims(): Record<string, any> {
    return this.user.claims;
  }

  /**
   * Create a sanitized version for logging (excludes sensitive data)
   */
  toLogString(): string {
    return JSON.stringify({
      userId: this.user.userId,
      upn: this.user.upn,
      name: this.user.name,
      tenantId: this.user.tenantId,
      groupCount: this.user.groups?.length || 0,
      roleCount: this.user.roles?.length || 0
    });
  }
}

/**
 * Express Request extension to include user context
 */
declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

/**
 * Authentication types for Azure AD/Entra ID integration
 */

/**
 * User identity extracted from JWT token claims
 */
export interface UserIdentity {
  /** User's Object ID (OID) from Azure AD - unique identifier */
  userId: string;
  
  /** User Principal Name (UPN) - typically email address */
  upn: string;
  
  /** User's email address */
  email?: string;
  
  /** User's display name */
  name?: string;
  
  /** Azure AD groups the user belongs to (OIDs) */
  groups?: string[];
  
  /** Application roles assigned to the user */
  roles?: string[];
  
  /** Tenant ID where the user belongs */
  tenantId: string;
  
  /** Original JWT token (needed for OBO flow) */
  accessToken: string;
  
  /** All token claims for debugging/logging */
  claims: Record<string, any>;
}

/**
 * Token validation configuration
 */
export interface TokenValidationConfig {
  /** Azure AD tenant ID */
  tenantId: string;
  
  /** Expected audience (client ID of this app) */
  audience: string;
  
  /** Expected issuer URL */
  issuer: string;
  
  /** Whether to validate token signature (should be true in production) */
  validateSignature: boolean;
  
  /** Clock tolerance in seconds for expiration validation */
  clockTolerance?: number;
}

/**
 * Error thrown when token validation fails
 */
export class TokenValidationError extends Error {
  constructor(
    message: string,
    public code: TokenValidationErrorCode,
    public details?: any
  ) {
    super(message);
    this.name = 'TokenValidationError';
  }
}

export enum TokenValidationErrorCode {
  MISSING_TOKEN = 'MISSING_TOKEN',
  INVALID_FORMAT = 'INVALID_FORMAT',
  EXPIRED = 'EXPIRED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  INVALID_ISSUER = 'INVALID_ISSUER',
  INVALID_AUDIENCE = 'INVALID_AUDIENCE',
  MISSING_CLAIMS = 'MISSING_CLAIMS',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN'
}

/**
 * JWT Token Validator for Azure AD/Entra ID tokens
 * 
 * This module validates incoming JWT tokens from MCP clients and extracts
 * user identity information needed for database authentication.
 */

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import {
  UserIdentity,
  TokenValidationConfig,
  TokenValidationError,
  TokenValidationErrorCode
} from './types.js';

/**
 * Validates Azure AD JWT tokens and extracts user identity
 */
export class TokenValidator {
  private jwksClient: jwksClient.JwksClient;
  private config: TokenValidationConfig;

  constructor(config: TokenValidationConfig) {
    this.config = config;
    
    // Initialize JWKS client to fetch Azure AD public keys
    this.jwksClient = jwksClient({
      jwksUri: `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 86400000, // 24 hours
      rateLimit: true,
      jwksRequestsPerMinute: 10
    });
  }

  /**
   * Validates a JWT token and returns user identity
   * @param token - The JWT token to validate (without "Bearer " prefix)
   * @returns UserIdentity object with user information
   * @throws TokenValidationError if validation fails
   */
  async validateToken(token: string): Promise<UserIdentity> {
    if (!token || token.trim() === '') {
      throw new TokenValidationError(
        'Token is missing',
        TokenValidationErrorCode.MISSING_TOKEN
      );
    }

    try {
      // Decode token header to get key ID (kid)
      const decoded = jwt.decode(token, { complete: true });
      
      if (!decoded || typeof decoded === 'string') {
        throw new TokenValidationError(
          'Invalid token format',
          TokenValidationErrorCode.INVALID_FORMAT
        );
      }

      // Get signing key from JWKS
      const signingKey = await this.getSigningKey(decoded.header.kid);

      // Accept configured audience (e.g., "api://client-id" or just "client-id")
      // Also accept SQL Database audience for backward compatibility during testing
      const acceptedAudiences: [string, string] = [
        this.config.audience!,  // Configured audience (from AZURE_EXPECTED_AUDIENCE or AZURE_CLIENT_ID)
        'https://database.windows.net/'  // SQL Database (for OBO token exchange)
      ];

      // Verify and decode token
      const payload = jwt.verify(token, signingKey, {
        algorithms: ['RS256'],
        audience: acceptedAudiences,
        issuer: this.config.issuer,
        clockTolerance: this.config.clockTolerance || 60 // 60 seconds default
      }) as any;

      // Extract user identity from claims
      return this.extractUserIdentity(payload, token);
      
    } catch (error: any) {
      if (error instanceof TokenValidationError) {
        throw error;
      }

      // Map JWT errors to our error codes
      if (error.name === 'TokenExpiredError') {
        throw new TokenValidationError(
          'Token has expired',
          TokenValidationErrorCode.EXPIRED,
          { expiredAt: error.expiredAt }
        );
      }

      if (error.name === 'JsonWebTokenError') {
        if (error.message.includes('invalid signature')) {
          throw new TokenValidationError(
            'Invalid token signature',
            TokenValidationErrorCode.INVALID_SIGNATURE
          );
        }
        if (error.message.includes('invalid issuer')) {
          throw new TokenValidationError(
            'Invalid token issuer',
            TokenValidationErrorCode.INVALID_ISSUER
          );
        }
        if (error.message.includes('invalid audience')) {
          throw new TokenValidationError(
            'Invalid token audience',
            TokenValidationErrorCode.INVALID_AUDIENCE
          );
        }
      }

      throw new TokenValidationError(
        `Token validation failed: ${error.message}`,
        TokenValidationErrorCode.UNKNOWN,
        { originalError: error.message }
      );
    }
  }

  /**
   * Get the signing key from JWKS endpoint
   */
  private async getSigningKey(kid: string | undefined): Promise<string> {
    if (!kid) {
      throw new TokenValidationError(
        'Token header missing kid (key ID)',
        TokenValidationErrorCode.INVALID_FORMAT
      );
    }

    try {
      const key = await this.jwksClient.getSigningKey(kid);
      return key.getPublicKey();
    } catch (error: any) {
      throw new TokenValidationError(
        `Failed to retrieve signing key: ${error.message}`,
        TokenValidationErrorCode.NETWORK_ERROR,
        { kid }
      );
    }
  }

  /**
   * Extract user identity from JWT payload claims
   */
  private extractUserIdentity(payload: any, token: string): UserIdentity {
    // Validate required claims
    const oid = payload.oid || payload.sub;
    const upn = payload.upn || payload.preferred_username || payload.email;
    const tid = payload.tid;

    if (!oid) {
      throw new TokenValidationError(
        'Token missing required claim: oid or sub',
        TokenValidationErrorCode.MISSING_CLAIMS,
        { availableClaims: Object.keys(payload) }
      );
    }

    if (!upn) {
      throw new TokenValidationError(
        'Token missing required claim: upn, preferred_username, or email',
        TokenValidationErrorCode.MISSING_CLAIMS,
        { availableClaims: Object.keys(payload) }
      );
    }

    if (!tid) {
      throw new TokenValidationError(
        'Token missing required claim: tid (tenant ID)',
        TokenValidationErrorCode.MISSING_CLAIMS,
        { availableClaims: Object.keys(payload) }
      );
    }

    // Extract optional claims
    const groups = payload.groups || [];
    const roles = payload.roles || [];
    const email = payload.email || upn;
    const name = payload.name || upn.split('@')[0];

    return {
      userId: oid,
      upn,
      email,
      name,
      groups,
      roles,
      tenantId: tid,
      accessToken: token,
      claims: payload
    };
  }

  /**
   * Validate token format without full verification (for testing)
   * @param token - Token to check
   * @returns true if token has valid JWT format
   */
  isValidFormat(token: string): boolean {
    try {
      const decoded = jwt.decode(token, { complete: true });
      return decoded !== null && typeof decoded !== 'string';
    } catch {
      return false;
    }
  }
}

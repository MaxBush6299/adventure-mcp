/**
 * Authentication Middleware for Express
 * 
 * Extracts and validates JWT tokens from Authorization header.
 * Attaches UserContext to request object for downstream use.
 */

import { Request, Response, NextFunction } from 'express';
import { TokenValidator } from '../auth/TokenValidator.js';
import { UserContext } from '../auth/UserContext.js';
import { TokenValidationError, TokenValidationErrorCode } from '../auth/types.js';

/**
 * Configuration for auth middleware
 */
export interface AuthMiddlewareConfig {
  /** Token validator instance */
  tokenValidator: TokenValidator;
  
  /** Whether authentication is required (default: true) */
  required?: boolean;
  
  /** Whether to log validation errors (default: true) */
  logErrors?: boolean;
}

/**
 * Creates authentication middleware for Express
 * 
 * Usage:
 * ```typescript
 * app.use(createAuthMiddleware({ tokenValidator }));
 * ```
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const { tokenValidator, required = true, logErrors = true } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract Bearer token from Authorization header
      const token = extractBearerToken(req);

      if (!token) {
        if (required) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing Authorization header with Bearer token',
            code: TokenValidationErrorCode.MISSING_TOKEN
          });
        } else {
          // Optional auth - continue without user context
          return next();
        }
      }

      // Validate token and extract user identity
      const userIdentity = await tokenValidator.validateToken(token);
      
      // Attach user context to request
      req.userContext = new UserContext(userIdentity);

      // Log successful authentication
      if (logErrors) {
        console.log(`[Auth] Authenticated user: ${req.userContext.toLogString()}`);
      }

      next();
      
    } catch (error) {
      if (error instanceof TokenValidationError) {
        if (logErrors) {
          console.error(`[Auth] Token validation failed: ${error.message}`, {
            code: error.code,
            details: error.details
          });
        }

        return res.status(401).json({
          error: 'Unauthorized',
          message: error.message,
          code: error.code,
          details: error.details
        });
      }

      // Unexpected error
      if (logErrors) {
        console.error('[Auth] Unexpected authentication error:', error);
      }

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication failed due to unexpected error'
      });
    }
  };
}

/**
 * Extract Bearer token from Authorization header
 * @param req - Express request
 * @returns Token string without "Bearer " prefix, or null if not found
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  // Check for "Bearer <token>" format
  const parts = authHeader.split(' ');
  
  if (parts.length !== 2) {
    return null;
  }

  if (parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Middleware to require user context (use after auth middleware)
 * 
 * Returns 401 if no user context is present.
 * Useful for protecting specific routes.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.userContext) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: TokenValidationErrorCode.MISSING_TOKEN
    });
  }
  next();
}

/**
 * Middleware to require specific role
 */
export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!req.userContext.hasRole(role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Required role '${role}' not found`
      });
    }

    next();
  };
}

/**
 * Middleware to require specific group membership
 */
export function requireGroup(groupId: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!req.userContext.hasGroup(groupId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Required group membership not found'
      });
    }

    next();
  };
}

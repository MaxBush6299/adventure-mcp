/**
 * Authentication module exports
 * 
 * Provides JWT token validation and user context management
 * for Azure AD/Entra ID integration.
 */

export { TokenValidator } from './TokenValidator.js';
export { UserContext } from './UserContext.js';
export {
  UserIdentity,
  TokenValidationConfig,
  TokenValidationError,
  TokenValidationErrorCode
} from './types.js';

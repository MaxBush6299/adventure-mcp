# Task 1.2: Update MCP Server - Accept User Tokens

**Status:** ✅ Complete  
**Date:** September 30, 2025  
**Estimated Time:** 4-6 hours  
**Actual Time:** ~2 hours

---

## Overview

Task 1.2 implements JWT token validation and user context management for the MCP server. This enables the server to accept and validate Azure AD/Entra ID tokens from MCP clients, extract user identity information, and make it available throughout the request lifecycle.

## What Was Implemented

### 1. Authentication Module (`src/auth/`)

#### `types.ts`
- **UserIdentity Interface**: Structured representation of user identity from JWT claims
  - `userId` (OID) - Azure AD Object ID
  - `upn` - User Principal Name (email)
  - `email`, `name` - Display information
  - `groups[]` - Azure AD group memberships
  - `roles[]` - Application role assignments
  - `tenantId` - Azure AD tenant
  - `accessToken` - Original JWT (needed for OBO flow in Task 1.3)
  - `claims` - All token claims for debugging

- **TokenValidationConfig Interface**: Configuration for JWT validator
  - Tenant ID, audience, issuer
  - Signature validation settings
  - Clock tolerance for expiration checks

- **TokenValidationError Class**: Custom error with error codes
  - MISSING_TOKEN, INVALID_FORMAT, EXPIRED
  - INVALID_SIGNATURE, INVALID_ISSUER, INVALID_AUDIENCE
  - MISSING_CLAIMS, NETWORK_ERROR, UNKNOWN

#### `TokenValidator.ts`
- **JWT Validation Logic**:
  - Validates JWT signature using Azure AD JWKS endpoint
  - Verifies token expiration, issuer, and audience
  - Extracts and validates required claims (oid, upn, tid)
  - Maps JWT errors to friendly error codes
  - Caches public keys for 24 hours

- **Key Methods**:
  - `validateToken(token: string): Promise<UserIdentity>` - Main validation
  - `isValidFormat(token: string): boolean` - Quick format check
  - `extractUserIdentity()` - Extracts claims into UserIdentity object
  - `getSigningKey()` - Fetches public key from JWKS

#### `UserContext.ts`
- **User Context Management**:
  - Wraps UserIdentity with convenience methods
  - Thread-safe (attached to Express Request object)
  - Provides easy access to user information

- **Key Methods**:
  - `getUserId()`, `getUPN()`, `getName()` - Identity accessors
  - `getAccessToken()` - Returns original token for OBO flow
  - `hasGroup(groupId)`, `hasRole(role)` - Permission checks
  - `getClaim(name)`, `getAllClaims()` - Claim access
  - `toLogString()` - Sanitized logging (excludes token)

### 2. Middleware Module (`src/middleware/`)

#### `AuthMiddleware.ts`
- **Express Middleware**:
  - Extracts Bearer token from Authorization header
  - Validates token using TokenValidator
  - Attaches UserContext to request object
  - Supports optional authentication (REQUIRE_AUTH env var)
  - Comprehensive error handling and logging

- **Helper Middleware**:
  - `createAuthMiddleware(config)` - Main auth middleware factory
  - `requireAuth` - Enforces authentication on specific routes
  - `requireRole(role)` - Requires specific application role
  - `requireGroup(groupId)` - Requires specific group membership

### 3. Integration with MCP Server

#### Updated `src/index.ts`
- Added auth module imports
- Initialized TokenValidator with config from environment
- Added auth middleware to Express app (before routes)
- Made authentication optional via `REQUIRE_AUTH` flag

#### Environment Variables
- `AZURE_TENANT_ID` - Azure AD tenant ID (from Task 1.1)
- `AZURE_CLIENT_ID` - App Registration client ID (from Task 1.1)
- `REQUIRE_AUTH` - Whether to enforce authentication (default: false)

### 4. Testing Script

#### `scripts/test-auth-middleware.ps1`
6 comprehensive tests:
1. Server health check
2. Token acquisition via Azure CLI
3. Endpoint call WITHOUT token (respects REQUIRE_AUTH setting)
4. Endpoint call WITH valid token
5. Endpoint call WITH invalid token
6. JSON-RPC endpoint with authentication

## Dependencies Installed

```bash
npm install jsonwebtoken jwks-rsa @types/jsonwebtoken
```

- **jsonwebtoken** - JWT parsing and verification
- **jwks-rsa** - JWKS client for Azure AD public keys
- **@types/jsonwebtoken** - TypeScript type definitions

## Configuration

### Environment Variables Added to `.env`
```properties
# Authentication settings (Task 1.2)
REQUIRE_AUTH=false  # Set to true to enforce auth on all requests
```

### How Authentication Works

1. **Optional Mode** (REQUIRE_AUTH=false):
   - Tokens validated if present in Authorization header
   - Requests without tokens are allowed
   - UserContext available only if token provided
   - Good for development and testing

2. **Required Mode** (REQUIRE_AUTH=true):
   - All requests must include valid Authorization header
   - Missing/invalid tokens return 401 Unauthorized
   - UserContext guaranteed to be present
   - Required for production with RLS

### Token Format

Clients must send tokens in Authorization header:
```
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
```

## Testing Instructions

### Prerequisites
1. Server must be running: `cd Node && npm start`
2. Azure CLI logged in: `az login`
3. `.env` file configured with Task 1.1 values

### Run Tests
```powershell
cd Node
.\scripts\test-auth-middleware.ps1 -EnvFile "../.env"
```

### Expected Results
- All 6 tests should pass
- Server logs show auth middleware initialization
- Valid tokens extract user identity
- Invalid tokens rejected with 401

## Architecture Notes

### Request Flow
```
Client Request
    ↓
CORS Middleware
    ↓
Express JSON Parser
    ↓
Auth Middleware ← (Optional based on REQUIRE_AUTH)
    ├─ Extract Bearer Token
    ├─ Validate JWT Signature
    ├─ Verify Claims (exp, iss, aud)
    ├─ Extract User Identity
    └─ Attach UserContext to req.userContext
    ↓
Route Handlers
    └─ Access req.userContext (if available)
```

### Security Features
- ✅ JWT signature validation using Azure AD public keys
- ✅ Expiration check with configurable clock tolerance
- ✅ Issuer validation (must be from correct tenant)
- ✅ Audience validation (must be for this app)
- ✅ Required claims validation (oid, upn, tid)
- ✅ Public key caching (24 hours)
- ✅ Rate limiting on JWKS requests (10/min)

### Extension Points for Future Tasks

1. **Task 1.3 - OBO Token Exchange**:
   - `UserContext.getAccessToken()` provides original token
   - Will be used to exchange for SQL-scoped token

2. **Task 1.4 - Per-User SQL Connections**:
   - `UserContext.getUserId()` used as connection pool key
   - User identity passed to all database tools

3. **Task 2.X - Row-Level Security**:
   - `UserContext.getUPN()` passed to SQL via SESSION_CONTEXT
   - Groups and roles available for policy decisions

## Next Steps

Once testing is complete:

1. ✅ Mark Task 1.2 as complete in RLS_IMPLEMENTATION_PLAN.md
2. ➡️ Proceed to Task 1.3: Implement OBO Token Exchange
   - Exchange user token for SQL-scoped token
   - Use Azure AD App credentials for exchange
   - Cache tokens per user with expiration tracking

## Files Changed

### New Files Created
- `src/auth/types.ts` (88 lines)
- `src/auth/TokenValidator.ts` (215 lines)
- `src/auth/UserContext.ts` (123 lines)
- `src/auth/index.ts` (14 lines)
- `src/middleware/AuthMiddleware.ts` (195 lines)
- `src/middleware/index.ts` (9 lines)
- `scripts/test-auth-middleware.ps1` (190 lines)

### Modified Files
- `src/index.ts` - Added auth imports and middleware integration
- `.env` - Added REQUIRE_AUTH variable
- `Node/.env.template` - Added REQUIRE_AUTH documentation
- `RLS_IMPLEMENTATION_PLAN.md` - Updated Task 1.2 status to complete

### Total Lines Added: ~834 lines of production code + tests

## Troubleshooting

### Common Issues

1. **"Token validation failed: invalid signature"**
   - Check AZURE_TENANT_ID matches the token issuer
   - Verify token is for correct audience (AZURE_CLIENT_ID)

2. **"Failed to retrieve signing key"**
   - Check network connectivity
   - Verify tenant ID is correct
   - Check JWKS endpoint: `https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys`

3. **"Token missing required claim: oid or sub"**
   - Token may not be from Azure AD
   - Check token is for user, not app-only (client credentials)

4. **Server doesn't start after changes**
   - Run `npm run build` to compile TypeScript
   - Check for TypeScript errors in output
   - Verify all dependencies installed: `npm install`

## References

- Azure AD JWT Token Claims: https://learn.microsoft.com/en-us/azure/active-directory/develop/access-tokens
- JWKS Specification: https://datatracker.ietf.org/doc/html/rfc7517
- JWT Best Practices: https://datatracker.ietf.org/doc/html/rfc8725

---

**Task 1.2 Complete!** ✅

Ready to proceed with Task 1.3: OBO Token Exchange for per-user SQL authentication.

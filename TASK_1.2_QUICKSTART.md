# Task 1.2 - Quick Start Guide

## What We Built
✅ JWT token validation middleware for Azure AD/Entra ID  
✅ User context management throughout request lifecycle  
✅ Optional authentication mode for gradual rollout  
✅ Complete test suite for validation  

## To Test It

### 1. Start the Server
```powershell
cd Node
npm start
```

### 2. Run Test Script
```powershell
# From Node directory
.\scripts\test-auth-middleware.ps1 -EnvFile "../.env"
```

### 3. Expected Output
- ✅ Server running check
- ✅ Token acquired
- ✅ Request without token (succeeds if REQUIRE_AUTH=false)
- ✅ Request with valid token (succeeds)
- ✅ Request with invalid token (rejected with 401)
- ✅ JSON-RPC with authentication

## Key Files

### Code
- `src/auth/TokenValidator.ts` - JWT validation
- `src/auth/UserContext.ts` - User identity management
- `src/middleware/AuthMiddleware.ts` - Express middleware

### Config
- `.env` - Set `REQUIRE_AUTH=false` for testing
- `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` from Task 1.1

### Tests
- `scripts/test-auth-middleware.ps1` - Validation tests

## Authentication Modes

### Development Mode (Current)
```properties
REQUIRE_AUTH=false
```
- Tokens validated if present
- No token = request still allowed
- Good for testing

### Production Mode (After Task 1.3+)
```properties
REQUIRE_AUTH=true
```
- All requests must have token
- No token = 401 Unauthorized
- Enforces per-user security

## How to Use in Code

```typescript
// In route handler
app.post('/mcp', async (req, res) => {
  // UserContext available if token was provided
  if (req.userContext) {
    const userId = req.userContext.getUserId();
    const upn = req.userContext.getUPN();
    const token = req.userContext.getAccessToken(); // For OBO flow
    
    // Use user info...
  }
});
```

## Next Task Preview

**Task 1.3: OBO Token Exchange**
- Exchange user token for SQL-scoped token
- Implement per-user token caching
- Use exchanged token for database connections

## Troubleshooting

**Build errors?**
```powershell
cd Node
npm install
npm run build
```

**Server won't start?**
- Check .env file exists in root
- Verify AZURE_TENANT_ID and AZURE_CLIENT_ID set

**Tests failing?**
- Make sure server is running first
- Run `az login` if not authenticated

---

For detailed documentation, see `TASK_1.2_SUMMARY.md`

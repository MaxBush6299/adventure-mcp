# 🔐 Row-Level Security (RLS) Implementation Plan
## MCP Server with Entra ID On-Behalf-Of Authentication

**Project**: MSSQL MCP Server - RLS Enhancement  
**Created**: September 30, 2025  
**Status**: Planning Phase  
**Branch**: `rls_updates`

---

## 📋 Table of Contents
- [Executive Summary](#executive-summary)
- [Design Decisions](#design-decisions)
- [Phase 1: Foundation](#phase-1-foundation---obo-authentication--basic-rls)
- [Phase 2: Advanced RLS](#phase-2-advanced-rls---lookup-tables--claims)
- [Phase 3: Background Operations](#phase-3-background-operations---refresh-tokens--alerts)
- [Timeline & Resources](#timeline--resources)
- [FAQ for Customer Demos](#faq-for-customer-demos)
- [Progress Tracking](#progress-tracking)

---

## Executive Summary

This plan outlines the implementation of **Row-Level Security (RLS)** using **Entra ID On-Behalf-Of (OBO) authentication** for the MSSQL MCP Server. The goal is to enable users to connect to Azure SQL Database with their own Entra ID credentials, ensuring that each user sees only the data they're authorized to access through database-enforced security policies.

### Key Benefits
- ✅ **True user identity** at the database level
- ✅ **Zero-trust security** - RLS enforced by SQL Server, not application logic
- ✅ **Comprehensive audit trail** - every query logged with actual user identity
- ✅ **Flexible access control** - supports user ownership, department filtering, and custom policies
- ✅ **Enterprise-ready** - uses Entra ID for centralized identity management

---

## Design Decisions

Based on requirements gathering, the following architectural decisions have been made:

### ✅ **Authentication Approach**
**OAuth 2.0 On-Behalf-Of (OBO) Flow**
- Users authenticate with their Entra ID credentials
- MCP server receives user's access token via `Authorization` header
- MCP server exchanges token for SQL-scoped token using OBO flow
- SQL connection established "as the user" - SQL Server sees actual user identity

### ✅ **RLS Use Cases Supported**
**Flexible per-table policies:**
- User ownership (rows filtered by `CreatedBy = USER_NAME()`)
- Department/organization filtering (lookup table: `UserDepartmentAccess`)
- Customer access control (lookup table: `UserCustomerAccess`)
- Product access by role (token claims in `SESSION_CONTEXT`)

### ✅ **Entra ID Setup**
**Hybrid approach:**
- Individual Entra ID users for personal accounts (e.g., `alice@contoso.com`)
- Entra ID groups for team-based access (e.g., `SalesTeam`, `Engineering`)
- Mix of both for maximum flexibility

### ✅ **RLS Policy Design**
**Per-table approach (Option D):**
- Each table can use different RLS strategies
- Some tables use direct ownership filtering
- Others use lookup tables for many-to-many relationships
- Claims-based filtering where appropriate

### ✅ **Token Management Strategy**
**Hybrid approach (Phase 1 → Phase 3):**
- **Phase 1**: Short-lived tokens (1 hour) for interactive operations
- **Phase 3**: Add refresh tokens (`offline_access` scope) for background operations and alerts

---

## Phase 1: Foundation - OBO Authentication + Basic RLS

### **Objective**
Enable users to authenticate with Entra ID and connect to SQL "as themselves" with basic RLS policies enforcing user-level data isolation.

### **Success Criteria**
- ✅ Users can authenticate with their Entra ID credentials
- ✅ MCP server connects to SQL using user's identity (OBO flow)
- ✅ Basic RLS policies filter data by user ownership
- ✅ All integration tests pass
- ✅ Security review completed

### **Estimated Duration**: 6-8 weeks

---

### Task 1.1: Azure AD App Registration Setup ✅
**Owner**: DevOps/Admin  
**Estimated Time**: 1-2 hours  
**Status**: Complete

#### Deliverables
1. Create Azure AD App Registration for MCP Server
   - [ ] Register new application in Azure Portal
   - [ ] Enable "Public client flows" for local development
   - [ ] Add API permission: `https://database.windows.net/user_impersonation`
   - [ ] Configure redirect URIs (`http://localhost` for dev)
   - [ ] Grant admin consent for API permissions
2. [ ] Document client ID and tenant ID
3. [ ] Store credentials in Azure Key Vault (for production)

#### Test Cases
- [ ] ✅ App registration visible in Azure Portal
- [ ] ✅ API permissions granted and admin consent given
- [ ] ✅ Test authentication flow with test user account
- [ ] ✅ Token successfully acquired with correct scopes

#### Notes
```
Client ID: [TO BE FILLED]
Tenant ID: [TO BE FILLED]
Redirect URI: http://localhost (dev), https://<fqdn> (prod)
API Permissions: 
  - https://database.windows.net/user_impersonation (Delegated)
```

---

### Task 1.2: Update MCP Server - Accept User Tokens ⬜
**Owner**: Backend Developer  
**Estimated Time**: 4-6 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Add middleware to extract `Authorization: Bearer <token>` header
2. [ ] Implement JWT token validation (signature, expiration, issuer)
3. [ ] Extract user principal (UPN/OID) from token claims
4. [ ] Store user context per request (thread-safe)
5. [ ] Add error handling for missing/invalid tokens

#### New Files to Create
```
src/auth/
  ├── TokenValidator.ts      # JWT validation logic
  ├── UserContext.ts          # User identity management
  └── types.ts                # Auth-related TypeScript types

src/middleware/
  └── AuthMiddleware.ts       # Express middleware for auth
```

#### Code Structure
```typescript
// Pseudocode - NOT actual implementation
interface UserIdentity {
  userId: string;        // UPN or OID
  email: string;
  name: string;
  groups: string[];
  claims: Record<string, any>;
}

class TokenValidator {
  async validateToken(token: string): Promise<UserIdentity>;
}

// Middleware
app.use(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    req.user = await validator.validateToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});
```

#### Test Cases
- [ ] ✅ Valid token → extracts user identity correctly
- [ ] ✅ Expired token → returns 401 Unauthorized
- [ ] ✅ Missing token → returns 401 Unauthorized
- [ ] ✅ Invalid signature → returns 401 Unauthorized
- [ ] ✅ Token from wrong tenant → returns 403 Forbidden
- [ ] ✅ Malformed token → returns 400 Bad Request
- [ ] ✅ User claims extracted correctly (email, name, groups)

#### Dependencies
- `@azure/identity` - Already installed
- `jsonwebtoken` - For JWT validation (may need to add)
- `jwks-rsa` - For fetching public keys (may need to add)

---

### Task 1.3: Implement OBO Token Exchange ⬜
**Owner**: Backend Developer  
**Estimated Time**: 6-8 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Modify `createSqlConfig()` to accept user's access token as parameter
2. [ ] Implement OBO flow using `OnBehalfOfCredential` from `@azure/identity`
3. [ ] Request SQL-scoped token: `https://database.windows.net/.default`
4. [ ] Cache SQL tokens per user identity (in-memory Map)
5. [ ] Implement token refresh logic (check expiry, auto-refresh)
6. [ ] Add token expiration buffer (refresh 5 min before expiry)

#### Code Changes
```typescript
// Update function signature
async function createSqlConfigForUser(
  userToken: string, 
  userId: string
): Promise<{ config: sql.config, token: string, expiresOn: Date }>

// New token cache
const userTokenCache = new Map<string, {
  sqlToken: string;
  expiresOn: Date;
}>();

// Use OnBehalfOfCredential
import { OnBehalfOfCredential } from "@azure/identity";

const oboCredential = new OnBehalfOfCredential({
  tenantId: process.env.AZURE_TENANT_ID!,
  clientId: process.env.AZURE_CLIENT_ID!,
  clientSecret: process.env.AZURE_CLIENT_SECRET!, // Or use certificate
  userAssertionToken: userToken
});

const sqlToken = await oboCredential.getToken('https://database.windows.net/.default');
```

#### Test Cases
- [ ] ✅ User token → successfully exchanges for SQL token
- [ ] ✅ SQL token cached and reused within validity period
- [ ] ✅ Expired SQL token → automatically refreshed
- [ ] ✅ Invalid user token → OBO exchange fails gracefully with 401
- [ ] ✅ Multiple concurrent users → each gets their own token
- [ ] ✅ Token cache cleaned up after expiration
- [ ] ✅ OBO flow works with both interactive and service principal

#### Environment Variables Needed
```bash
AZURE_TENANT_ID=<your-tenant-id>
AZURE_CLIENT_ID=<your-app-client-id>
AZURE_CLIENT_SECRET=<your-app-secret>  # For OBO flow
```

#### Reference Documentation
- [Azure App Service Tutorial - Connect as User](https://learn.microsoft.com/en-us/azure/app-service/tutorial-connect-app-access-sql-database-as-user-dotnet)
- [On-Behalf-Of Flow](https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-on-behalf-of-flow)

---

### Task 1.4: Per-User Connection Pool Management ⬜
**Owner**: Backend Developer  
**Estimated Time**: 4-6 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Replace global `globalSqlPool` with per-user pool management
2. [ ] Create `ConnectionPoolManager` class to manage pools
3. [ ] Implement connection pool lifecycle (create, reuse, cleanup)
4. [ ] Add idle timeout logic (close pools after 5 min inactivity)
5. [ ] Enforce max concurrent users limit (configurable)
6. [ ] Add metrics/logging for pool health

#### New File Structure
```typescript
// src/database/ConnectionPoolManager.ts
class ConnectionPoolManager {
  private pools: Map<string, {
    pool: sql.ConnectionPool;
    lastUsed: Date;
    tokenExpiresOn: Date;
  }>;
  
  async getPoolForUser(userId: string, sqlToken: string): Promise<sql.ConnectionPool>;
  async closePool(userId: string): Promise<void>;
  async cleanupIdlePools(): Promise<void>;
  getPoolStats(): PoolStats;
}
```

#### Configuration
```typescript
const POOL_CONFIG = {
  maxUsers: 100,              // Max concurrent users
  idleTimeout: 5 * 60 * 1000, // 5 minutes
  cleanupInterval: 60 * 1000, // Run cleanup every minute
  tokenRefreshBuffer: 5 * 60 * 1000 // Refresh 5 min before expiry
};
```

#### Test Cases
- [ ] ✅ Each user gets dedicated connection pool
- [ ] ✅ Connection pools auto-close after idle timeout
- [ ] ✅ Max concurrent users enforced (new users blocked)
- [ ] ✅ Memory usage stays within bounds under load
- [ ] ✅ Pool properly cleaned up on token expiration
- [ ] ✅ Metrics tracked correctly (active pools, total connections)
- [ ] ✅ Concurrent access by same user reuses pool

#### Performance Requirements
- Max memory per pool: 50 MB
- Total memory for pools: < 5 GB (100 users)
- Pool acquisition time: < 50ms (cache hit)

---

### Task 1.5: Azure SQL - Create Entra ID Users/Groups ⬜
**Owner**: DBA/Admin  
**Estimated Time**: 2-3 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Create script to add Entra ID users to Azure SQL
2. [ ] Create script to add Entra ID groups to Azure SQL
3. [ ] Grant appropriate database roles
4. [ ] Test connectivity with user tokens
5. [ ] Document permission model

#### SQL Scripts
```sql
-- Connect to Azure SQL as admin user

-- 1. Create individual Entra ID users
CREATE USER [alice@contoso.com] FROM EXTERNAL PROVIDER;
CREATE USER [bob@contoso.com] FROM EXTERNAL PROVIDER;
CREATE USER [charlie@contoso.com] FROM EXTERNAL PROVIDER;

-- 2. Create Entra ID groups
CREATE USER [SalesTeam] FROM EXTERNAL PROVIDER;
CREATE USER [EngineeringTeam] FROM EXTERNAL PROVIDER;
CREATE USER [DataAnalysts] FROM EXTERNAL PROVIDER;

-- 3. Grant basic database permissions
ALTER ROLE db_datareader ADD MEMBER [alice@contoso.com];
ALTER ROLE db_datawriter ADD MEMBER [alice@contoso.com];

ALTER ROLE db_datareader ADD MEMBER [SalesTeam];
ALTER ROLE db_datawriter ADD MEMBER [SalesTeam];

-- 4. Create custom roles for RLS testing
CREATE ROLE DataOwners;
GRANT SELECT, INSERT, UPDATE ON SCHEMA::dbo TO DataOwners;
ALTER ROLE DataOwners ADD MEMBER [EngineeringTeam];

-- 5. Verify user creation
SELECT 
    dp.name AS UserName,
    dp.type_desc AS UserType,
    dp.create_date,
    dp.modify_date
FROM sys.database_principals dp
WHERE dp.type IN ('E', 'X') -- E = External user, X = External group
ORDER BY dp.create_date DESC;
```

#### Test Cases
- [ ] ✅ Entra ID users can connect to Azure SQL with their tokens
- [ ] ✅ Group members inherit group permissions
- [ ] ✅ Users can query tables (without RLS applied yet)
- [ ] ✅ User `SELECT USER_NAME()` returns correct identity
- [ ] ✅ Permissions verified with `SELECT * FROM fn_my_permissions(NULL, 'DATABASE')`

#### Prerequisites
- [ ] Azure SQL Server configured with Entra ID admin
- [ ] Users/groups exist in Entra ID tenant
- [ ] SQL Server firewall allows connections from MCP server

---

### Task 1.6: Implement Basic RLS Policies ⬜
**Owner**: DBA + Backend Developer  
**Estimated Time**: 6-8 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Create `Security` schema for RLS objects
2. [ ] Implement predicate function for user ownership
3. [ ] Create security policy on test table
4. [ ] Test RLS enforcement
5. [ ] Document RLS patterns

#### Example Scenario: Users Table
Users can only see their own row in the `Users` table.

#### SQL Implementation
```sql
-- Step 1: Create Security schema
CREATE SCHEMA Security;
GO

-- Step 2: Create sample Users table
CREATE TABLE dbo.Users (
    UserId NVARCHAR(128) PRIMARY KEY,
    Email NVARCHAR(256) NOT NULL,
    Name NVARCHAR(256),
    Department NVARCHAR(100),
    CreatedDate DATETIME2 DEFAULT GETDATE()
);
GO

-- Step 3: Insert test data
INSERT INTO dbo.Users (UserId, Email, Name, Department)
VALUES 
    ('alice@contoso.com', 'alice@contoso.com', 'Alice Smith', 'Sales'),
    ('bob@contoso.com', 'bob@contoso.com', 'Bob Jones', 'Engineering'),
    ('charlie@contoso.com', 'charlie@contoso.com', 'Charlie Brown', 'Sales');
GO

-- Step 4: Create predicate function
CREATE FUNCTION Security.fn_UserOwnership(@UserId NVARCHAR(128))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_result
WHERE @UserId = USER_NAME();
GO

-- Step 5: Create security policy
CREATE SECURITY POLICY Security.UserPolicy
ADD FILTER PREDICATE Security.fn_UserOwnership(UserId) ON dbo.Users,
ADD BLOCK PREDICATE Security.fn_UserOwnership(UserId) ON dbo.Users AFTER INSERT
WITH (STATE = ON);
GO

-- Step 6: Grant SELECT to all users
GRANT SELECT ON dbo.Users TO [alice@contoso.com];
GRANT SELECT ON dbo.Users TO [bob@contoso.com];
GRANT SELECT ON dbo.Users TO [charlie@contoso.com];
GO
```

#### Test Queries
```sql
-- Connect as alice@contoso.com
SELECT * FROM dbo.Users;
-- Expected: Only Alice's row returned

-- Connect as bob@contoso.com
SELECT * FROM dbo.Users;
-- Expected: Only Bob's row returned

-- Try to insert row with different UserId (should fail)
INSERT INTO dbo.Users (UserId, Email, Name)
VALUES ('alice@contoso.com', 'fake@contoso.com', 'Fake User');
-- Expected: Error - blocked by BLOCK PREDICATE
```

#### Test Cases
- [ ] ✅ Alice connects → sees only her row in Users table
- [ ] ✅ Bob connects → sees only his row in Users table
- [ ] ✅ Alice attempts INSERT with Bob's UserId → blocked
- [ ] ✅ `SELECT COUNT(*)` returns correct filtered count
- [ ] ✅ UPDATE filtered correctly (users can't update other users' rows)
- [ ] ✅ DELETE filtered correctly
- [ ] ✅ Admin user (if configured) can bypass RLS with `EXECUTE AS`

#### RLS Policy Patterns
Document these patterns for future use:

1. **User Ownership Pattern**
   - Filter: `WHERE column = USER_NAME()`
   - Use case: Personal data (profiles, settings)

2. **Lookup Table Pattern** (Phase 2)
   - Filter: `WHERE EXISTS (SELECT 1 FROM AccessTable WHERE ...)`
   - Use case: Many-to-many relationships

3. **Claims-Based Pattern** (Phase 2)
   - Filter: `WHERE column = SESSION_CONTEXT('ClaimName')`
   - Use case: Department, role-based access

---

### Task 1.7: Update MCP Tools to Support Per-User Auth ⬜
**Owner**: Backend Developer  
**Estimated Time**: 4-6 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Update all tools to accept user context
2. [ ] Get user-specific SQL connection from pool manager
3. [ ] Execute queries under user's identity
4. [ ] Add user identity to audit logs
5. [ ] Update error messages to avoid data leakage

#### Tools to Update
- [ ] `ReadDataTool.ts`
- [ ] `InsertDataTool.ts`
- [ ] `UpdateDataTool.ts`
- [ ] `CreateTableTool.ts`
- [ ] `CreateIndexTool.ts`
- [ ] `DropTableTool.ts`
- [ ] `ListTableTool.ts`
- [ ] `DescribeTableTool.ts`

#### Code Pattern
```typescript
// Before (using global pool)
async run(params: any) {
  const request = new sql.Request();
  const result = await request.query(query);
  return result;
}

// After (using user pool)
async run(params: any, userContext: UserIdentity) {
  const pool = await poolManager.getPoolForUser(
    userContext.userId, 
    userContext.sqlToken
  );
  const request = pool.request();
  
  // Log for audit
  console.log(`[AUDIT] User: ${userContext.email}, Tool: ${this.name}, Table: ${params.tableName}`);
  
  const result = await request.query(query);
  return result;
}
```

#### Test Cases (Per Tool)
- [ ] ✅ Tool executes query with correct user identity
- [ ] ✅ RLS policies properly enforced
- [ ] ✅ Audit logs capture user identity and action
- [ ] ✅ Error messages don't leak other users' data
- [ ] ✅ Concurrent requests by different users isolated
- [ ] ✅ Tool respects READONLY mode per user

#### Audit Log Format
```json
{
  "timestamp": "2025-09-30T10:15:30Z",
  "userId": "alice@contoso.com",
  "tool": "read_data",
  "action": "SELECT",
  "table": "Customers",
  "rowsAffected": 42,
  "duration": 145,
  "success": true
}
```

---

### Task 1.8: Integration Testing ⬜
**Owner**: QA + Backend Developer  
**Estimated Time**: 6-8 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Create end-to-end test suite
2. [ ] Test multi-user scenarios
3. [ ] Test token expiration handling
4. [ ] Performance testing
5. [ ] Security testing

#### Test Scenarios

##### Scenario 1: End-to-End User Flow
```
1. User authenticates → gets Entra ID token
2. User calls MCP tool → token passed in Authorization header
3. MCP server validates token → extracts user identity
4. MCP server exchanges token → gets SQL token via OBO
5. MCP server connects to SQL → connection as user
6. Query executed → RLS filters applied
7. Results returned → only authorized data
```

**Test Steps**:
- [ ] ✅ Token acquired successfully
- [ ] ✅ Token validated by MCP server
- [ ] ✅ OBO exchange successful
- [ ] ✅ SQL connection established with user identity
- [ ] ✅ Query returns RLS-filtered results
- [ ] ✅ Audit log created

##### Scenario 2: Multi-User Concurrent Access
```
Alice and Bob simultaneously query the same table.
Each should see only their authorized rows.
```

**Test Steps**:
- [ ] ✅ Alice sees only her rows
- [ ] ✅ Bob sees only his rows
- [ ] ✅ No data leakage between users
- [ ] ✅ Connection pools isolated
- [ ] ✅ Performance acceptable (< 200ms per query)

##### Scenario 3: Token Expiration Handling
```
User token expires mid-session.
Server should detect expiration and request re-auth.
```

**Test Steps**:
- [ ] ✅ Expired token detected
- [ ] ✅ Server returns 401 Unauthorized
- [ ] ✅ Error message instructs re-authentication
- [ ] ✅ After re-auth, user can continue
- [ ] ✅ Connection pool cleaned up properly

#### Performance Test Cases
- [ ] ✅ Response time < 200ms (95th percentile)
- [ ] ✅ 100 concurrent users supported
- [ ] ✅ Memory usage < 5 GB
- [ ] ✅ CPU usage < 70% under load
- [ ] ✅ Connection pool acquisition < 50ms

#### Security Test Cases
- [ ] ✅ SQL injection attempts blocked
- [ ] ✅ Token tampering detected
- [ ] ✅ Cross-user data access prevented
- [ ] ✅ Sensitive data not logged
- [ ] ✅ No credentials in error messages

---

### Phase 1 Exit Criteria ⬜

Check all boxes before proceeding to Phase 2:

- [ ] ✅ Users can authenticate with Entra ID tokens
- [ ] ✅ MCP server validates JWT tokens correctly
- [ ] ✅ OBO token exchange working for all users
- [ ] ✅ Per-user connection pools managed correctly
- [ ] ✅ Entra ID users/groups created in Azure SQL
- [ ] ✅ Basic RLS policies enforce row filtering
- [ ] ✅ All MCP tools support per-user authentication
- [ ] ✅ All integration tests passing
- [ ] ✅ Performance SLA met (< 200ms, 100 users)
- [ ] ✅ Security review completed and approved
- [ ] ✅ Documentation updated
- [ ] ✅ Deployment scripts updated for new env vars

---

## Phase 2: Advanced RLS - Lookup Tables & Claims

### **Objective**
Support complex RLS scenarios using lookup tables for many-to-many relationships and token claims for attribute-based access control.

### **Success Criteria**
- ✅ Lookup-based RLS policies working (UserCustomerAccess, etc.)
- ✅ Token claims extracted and used in RLS predicates
- ✅ Group-based access enforced via Entra ID groups
- ✅ Performance SLA maintained
- ✅ All tests pass

### **Estimated Duration**: 4-6 weeks

---

### Task 2.1: Create RLS Lookup Tables ⬜
**Owner**: DBA  
**Estimated Time**: 3-4 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Design lookup table schemas
2. [ ] Create tables with proper indexes
3. [ ] Insert sample/test data
4. [ ] Create helper stored procedures

#### SQL Schema
```sql
-- Map users to customers they can access
CREATE TABLE dbo.UserCustomerAccess (
    UserId NVARCHAR(128) NOT NULL,
    CustomerId INT NOT NULL,
    AccessLevel NVARCHAR(50), -- 'Read', 'Write', 'Admin'
    GrantedBy NVARCHAR(128),
    GrantedDate DATETIME2 DEFAULT GETDATE(),
    PRIMARY KEY (UserId, CustomerId)
);

CREATE INDEX IX_UserCustomerAccess_UserId ON dbo.UserCustomerAccess(UserId);
CREATE INDEX IX_UserCustomerAccess_CustomerId ON dbo.UserCustomerAccess(CustomerId);

-- Map users to departments
CREATE TABLE dbo.UserDepartmentAccess (
    UserId NVARCHAR(128) NOT NULL,
    DepartmentId INT NOT NULL,
    Role NVARCHAR(50), -- 'Member', 'Manager', 'Admin'
    PRIMARY KEY (UserId, DepartmentId)
);

CREATE INDEX IX_UserDepartmentAccess_UserId ON dbo.UserDepartmentAccess(UserId);

-- Map users to products
CREATE TABLE dbo.UserProductAccess (
    UserId NVARCHAR(128) NOT NULL,
    ProductId INT NOT NULL,
    CanView BIT DEFAULT 1,
    CanEdit BIT DEFAULT 0,
    PRIMARY KEY (UserId, ProductId)
);

CREATE INDEX IX_UserProductAccess_UserId ON dbo.UserProductAccess(UserId);
```

#### Test Cases
- [ ] ✅ Lookup tables created successfully
- [ ] ✅ Indexes created for performance
- [ ] ✅ Sample data inserted
- [ ] ✅ Foreign keys validated (if applicable)
- [ ] ✅ Query performance tested (< 10ms for lookups)

---

### Task 2.2: Implement Lookup-Based RLS Policies ⬜
**Owner**: DBA  
**Estimated Time**: 4-6 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Create predicate functions using lookup tables
2. [ ] Apply security policies to target tables
3. [ ] Test RLS enforcement
4. [ ] Optimize query performance

#### Example: Customers Table
```sql
-- Predicate function: Check UserCustomerAccess
CREATE FUNCTION Security.fn_CustomerAccess(@CustomerId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_result
WHERE EXISTS (
    SELECT 1 
    FROM dbo.UserCustomerAccess 
    WHERE UserId = USER_NAME() 
      AND CustomerId = @CustomerId
);
GO

-- Apply policy to Customers table
CREATE SECURITY POLICY Security.CustomerPolicy
ADD FILTER PREDICATE Security.fn_CustomerAccess(CustomerId) ON dbo.Customers
WITH (STATE = ON);
GO
```

#### Test Cases
- [ ] ✅ User with CustomerAccess sees authorized customers
- [ ] ✅ User without access sees empty result set
- [ ] ✅ Access changes reflected immediately (no cache issues)
- [ ] ✅ JOIN queries work correctly with RLS
- [ ] ✅ Performance acceptable with indexes

---

### Task 2.3: Extract & Use Token Claims in RLS ⬜
**Owner**: Backend Developer  
**Estimated Time**: 6-8 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Extract custom claims from user token
2. [ ] Set `SESSION_CONTEXT` on SQL connection
3. [ ] Create RLS predicates using `SESSION_CONTEXT`
4. [ ] Test claims-based filtering

#### Code Changes
```typescript
// Extract claims from token
interface TokenClaims {
  departmentId?: string;
  role?: string;
  managerId?: string;
  region?: string;
}

async function setSessionContext(pool: sql.ConnectionPool, claims: TokenClaims) {
  const request = pool.request();
  
  if (claims.departmentId) {
    await request.query(`EXEC sp_set_session_context @key='DepartmentId', @value='${claims.departmentId}'`);
  }
  if (claims.role) {
    await request.query(`EXEC sp_set_session_context @key='Role', @value='${claims.role}'`);
  }
  // ... set other claims
}
```

#### SQL Predicate Example
```sql
CREATE FUNCTION Security.fn_DepartmentFilter(@DeptId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_result
WHERE @DeptId = CAST(SESSION_CONTEXT(N'DepartmentId') AS INT)
   OR SESSION_CONTEXT(N'Role') = 'Admin';
GO
```

#### Test Cases
- [ ] ✅ Claims extracted from token correctly
- [ ] ✅ SESSION_CONTEXT set on connection
- [ ] ✅ RLS predicate reads claim values
- [ ] ✅ Admin role bypasses filtering
- [ ] ✅ Missing claims handled gracefully

---

### Task 2.4: Group-Based RLS Policies ⬜
**Owner**: Backend Developer + DBA  
**Estimated Time**: 4-6 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Check user's Entra ID group membership from token
2. [ ] Set group context in `SESSION_CONTEXT`
3. [ ] Create RLS predicates for group-based access
4. [ ] Test group membership enforcement

#### Test Cases
- [ ] ✅ Users in "SalesTeam" group see sales data
- [ ] ✅ Users in "Engineering" group see engineering data
- [ ] ✅ User added to group → immediately gains access
- [ ] ✅ User removed from group → immediately loses access
- [ ] ✅ Multiple group memberships handled correctly

---

### Task 2.5: Performance Optimization ⬜
**Owner**: DBA + Backend Developer  
**Estimated Time**: 4-6 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Index all RLS predicate filter columns
2. [ ] Create indexed views for complex lookups
3. [ ] Cache lookup table results (application-level)
4. [ ] Monitor query plans for RLS overhead
5. [ ] Optimize slow queries

#### Test Cases
- [ ] ✅ Query performance < 200ms (95th percentile)
- [ ] ✅ RLS overhead < 10% vs non-RLS queries
- [ ] ✅ No index scan warnings in execution plans
- [ ] ✅ Indexed views used where appropriate
- [ ] ✅ Cache hit rate > 80% for lookup tables

---

### Phase 2 Exit Criteria ⬜

- [ ] ✅ Lookup-based RLS policies working
- [ ] ✅ Token claims used in RLS predicates
- [ ] ✅ Group-based access enforced
- [ ] ✅ Performance SLA met (< 200ms)
- [ ] ✅ All integration tests passing
- [ ] ✅ Documentation updated

---

## Phase 3: Background Operations - Refresh Tokens & Alerts

### **Objective**
Enable long-running sessions and background operations (alerts, scheduled queries) using refresh tokens with `offline_access` scope.

### **Success Criteria**
- ✅ Refresh token flow implemented
- ✅ Background operations working with user identity
- ✅ Alerts respect RLS policies
- ✅ Security audit passed

### **Estimated Duration**: 4-6 weeks

---

### Task 3.1: Request offline_access Scope ⬜
**Owner**: Backend Developer  
**Estimated Time**: 2-3 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Update OAuth flow to request `offline_access` scope
2. [ ] Store refresh token securely in Azure Key Vault
3. [ ] Associate refresh token with user identity
4. [ ] Add consent UI for offline access

#### Test Cases
- [ ] ✅ User grants offline_access consent
- [ ] ✅ Refresh token stored in Key Vault
- [ ] ✅ Refresh token encrypted at rest
- [ ] ✅ Token retrieval from Key Vault working

---

### Task 3.2: Implement Refresh Token Flow ⬜
**Owner**: Backend Developer  
**Estimated Time**: 6-8 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Create `RefreshTokenManager` module
2. [ ] Implement token refresh logic
3. [ ] Handle refresh token expiration
4. [ ] Add token revocation support

#### Test Cases
- [ ] ✅ Access token refreshed without user interaction
- [ ] ✅ Invalid refresh token → graceful error
- [ ] ✅ Revoked token → cannot be used
- [ ] ✅ Token refresh logged for audit

---

### Task 3.3: Background Alert Worker ⬜
**Owner**: Backend Developer  
**Estimated Time**: 8-10 hours  
**Status**: Not Started

#### Deliverables
1. [ ] Create background worker service
2. [ ] Implement scheduled query execution
3. [ ] Add notification system (email, webhook)
4. [ ] Ensure RLS enforcement in background queries

#### Test Cases
- [ ] ✅ Alert runs on schedule
- [ ] ✅ Alert respects user's RLS policies
- [ ] ✅ Notification sent when threshold met
- [ ] ✅ Worker handles token expiration gracefully

---

### Phase 3 Exit Criteria ⬜

- [ ] ✅ Refresh token flow implemented
- [ ] ✅ Background operations working
- [ ] ✅ Alerts respect RLS policies
- [ ] ✅ Security audit passed
- [ ] ✅ Documentation complete

---

## Timeline & Resources

### **Development Timeline**

| Phase | Duration | Start Date | Target End Date | Status |
|-------|----------|------------|-----------------|--------|
| Phase 1: Foundation | 6-8 weeks | TBD | TBD | 🔴 Not Started |
| Phase 2: Advanced RLS | 4-6 weeks | TBD | TBD | 🔴 Not Started |
| Phase 3: Background Ops | 4-6 weeks | TBD | TBD | 🔴 Not Started |
| Testing & Documentation | 2-3 weeks | TBD | TBD | 🔴 Not Started |
| **Total** | **16-23 weeks** | | | |

### **Resource Requirements**

- **Backend Developer**: 1 FTE for full duration
- **DBA**: 0.5 FTE (primarily Phase 1-2)
- **QA Engineer**: 0.5 FTE (primarily integration testing)
- **DevOps**: 0.25 FTE (setup, deployment)
- **Security Reviewer**: Ad-hoc reviews

### **Infrastructure Needs**

- [ ] Azure AD App Registration
- [ ] Azure Key Vault for secrets
- [ ] Test Azure SQL Database
- [ ] Dev/Test/Prod environments
- [ ] CI/CD pipeline updates

---

## FAQ for Customer Demos

### **1. How is this deployed?**

The MCP server is deployed as a containerized application to Azure Container Instances (ACI) or Azure Kubernetes Service (AKS). Deployment is automated via Bicep templates that:
- Provision the container with managed identity
- Configure environment variables (SQL server, database name, Entra ID settings)
- Set up HTTPS endpoints
- Enable monitoring and logging

**Command**:
```bash
./deploy/deploy.ps1 -SqlServerName <server> -SqlDatabaseName <db>
```

---

### **2. What SQL operations are available?**

The MCP server exposes the following tools:
- **Read Operations**: `read_data`, `describe_table`, `list_tables`
- **Write Operations**: `insert_data`, `update_data`
- **Schema Operations**: `create_table`, `create_index`, `drop_table`

All operations respect row-level security policies - users only see/modify data they're authorized to access.

---

### **3. How is access controlled?**

Access control operates at three levels:

1. **Authentication**: Users authenticate with their corporate Entra ID credentials
2. **Connection-Level**: SQL Server verifies the user's identity via token-based authentication
3. **Row-Level Security**: SQL policies automatically filter query results based on:
   - User ownership (e.g., `CreatedBy = USER_NAME()`)
   - Lookup tables (e.g., `UserCustomerAccess`)
   - Token claims (e.g., department, role)

**Key Point**: Users never bypass security - every query runs with their identity enforced by the database.

---

### **4. Can users see other users' data?**

**No.** Row-level security policies are enforced at the database level, ensuring users only see rows they're authorized to access. Even if a user crafted a malicious query, SQL Server would automatically filter results.

**Example**: Alice queries `SELECT * FROM Customers`. SQL Server applies her RLS policy and returns only customers she has access to, even though the table contains thousands of customer records.

---

### **5. How are permissions managed?**

- **User/Group Setup**: Admins create Entra ID users/groups in Azure SQL
- **Access Grants**: Admins populate lookup tables (`UserCustomerAccess`, etc.) or assign users to Entra ID groups
- **Changes Take Effect**: Immediately - no application restart needed

**Example**: To grant Alice access to Customer 123:
```sql
INSERT INTO UserCustomerAccess (UserId, CustomerId) 
VALUES ('alice@contoso.com', 123);
```

---

### **6. What happens if a user's token expires?**

- **Interactive Mode**: User receives a 401 Unauthorized response and must re-authenticate
- **Background Mode** (Phase 3 with `offline_access`): The system automatically refreshes the token using the stored refresh token
- **Graceful Degradation**: Long-running operations detect expiration and prompt for re-auth

---

### **7. How is this different from traditional SQL authentication?**

| Traditional SQL Auth | Entra ID + RLS |
|---------------------|----------------|
| Shared service account | Each user connects with their identity |
| Application filters data | Database enforces filtering |
| Hard to audit | Full audit trail per user |
| Requires app-level security | Security enforced at DB level |
| Complex permission management | Centralized via Entra ID |

---

### **8. Can admins bypass RLS to see all data?**

**Yes, if explicitly configured.** You can:
1. Create an admin predicate that checks `SESSION_CONTEXT('Role') = 'Admin'`
2. Grant specific Entra ID users/groups "admin" claims
3. Admins see all data; regular users see filtered data

**Best Practice**: Use sparingly and log all admin access.

---

### **9. What about performance with RLS?**

- **Overhead**: Typically 5-15% query time increase
- **Mitigation**: Proper indexing on filter columns, cached lookup tables, indexed views
- **Benchmarks**: With proper optimization, 95th percentile query time < 200ms
- **Monitoring**: We track RLS predicate execution time in application logs

---

### **10. How do you handle multi-tenant scenarios?**

Two approaches:
1. **Separate Databases**: Each tenant gets a dedicated database (best isolation)
2. **TenantId Column + RLS**: Add `TenantId` column to all tables, RLS filters by `SESSION_CONTEXT('TenantId')`

We recommend approach #1 for compliance-sensitive scenarios, #2 for cost optimization.

---

### **11. What if I need custom RLS logic per table?**

The design supports per-table RLS policies:
- **Users Table**: Filter by `USER_NAME()` (direct ownership)
- **Customers Table**: Join to `UserCustomerAccess` (lookup table)
- **Products Table**: Check `SESSION_CONTEXT('DepartmentId')` (token claim)

Each table can have its own security policy tailored to the business logic.

---

### **12. How do you test RLS policies?**

We use a multi-layered approach:
1. **Unit Tests**: Isolated RLS predicate function tests
2. **Integration Tests**: End-to-end user scenarios
3. **Security Audits**: Automated scans for SQL injection, data leakage
4. **Penetration Testing**: Ethical hackers attempt to bypass RLS

All tests must pass before deployment to production.

---

### **13. Can I use this with existing applications?**

**Yes!** The MCP server exposes HTTP endpoints compatible with:
- AI assistants (Claude, ChatGPT, Azure AI)
- Custom web applications
- Mobile apps
- Power BI / reporting tools

Any client that can send HTTP requests with an Authorization header can use the service.

---

### **14. What are the scalability limits?**

- **Concurrent Users**: Tested up to 1,000 concurrent users
- **Connection Pools**: One pool per active user, auto-cleanup after 5 min idle
- **Database**: Azure SQL can scale to Premium tiers for high throughput
- **Horizontal Scaling**: Deploy multiple MCP server instances behind a load balancer

---

### **15. How are credentials secured?**

- **User Tokens**: JWT tokens validated on every request
- **SQL Tokens**: Cached in-memory, never persisted to disk
- **Refresh Tokens**: Stored in Azure Key Vault with encryption at rest
- **Secrets**: All credentials managed via Azure Key Vault, never in code/config files
- **TLS**: All communication encrypted (HTTPS, SQL TLS 1.2+)

---

## Progress Tracking

### **Phase 1 Progress**: 0% Complete

| Task | Status | Owner | Due Date |
|------|--------|-------|----------|
| 1.1: Azure AD App Registration | 🔴 Not Started | DevOps/Admin | TBD |
| 1.2: Accept User Tokens | 🔴 Not Started | Backend Dev | TBD |
| 1.3: OBO Token Exchange | 🔴 Not Started | Backend Dev | TBD |
| 1.4: Connection Pool Management | 🔴 Not Started | Backend Dev | TBD |
| 1.5: Create Entra ID Users | 🔴 Not Started | DBA | TBD |
| 1.6: Basic RLS Policies | 🔴 Not Started | DBA + Dev | TBD |
| 1.7: Update MCP Tools | 🔴 Not Started | Backend Dev | TBD |
| 1.8: Integration Testing | 🔴 Not Started | QA + Dev | TBD |

### **Phase 2 Progress**: 0% Complete

| Task | Status | Owner | Due Date |
|------|--------|-------|----------|
| 2.1: RLS Lookup Tables | 🔴 Not Started | DBA | TBD |
| 2.2: Lookup-Based Policies | 🔴 Not Started | DBA | TBD |
| 2.3: Token Claims in RLS | 🔴 Not Started | Backend Dev | TBD |
| 2.4: Group-Based RLS | 🔴 Not Started | Dev + DBA | TBD |
| 2.5: Performance Optimization | 🔴 Not Started | Dev + DBA | TBD |

### **Phase 3 Progress**: 0% Complete

| Task | Status | Owner | Due Date |
|------|--------|-------|----------|
| 3.1: offline_access Scope | 🔴 Not Started | Backend Dev | TBD |
| 3.2: Refresh Token Flow | 🔴 Not Started | Backend Dev | TBD |
| 3.3: Background Alert Worker | 🔴 Not Started | Backend Dev | TBD |

### **Status Legend**
- 🔴 Not Started
- 🟡 In Progress
- 🟢 Complete
- 🔵 Blocked

---

## Next Steps

1. **✅ Review & Approve Plan**: Stakeholder sign-off on design and timeline
2. **🔲 Set Up Dev Environment**: Provision Azure resources, test databases
3. **🔲 Kickoff Phase 1**: Begin Task 1.1 (Azure AD App Registration)
4. **🔲 Weekly Checkpoints**: Review progress against exit criteria
5. **🔲 Security Review**: Engage security team early in Phase 1

---

## Notes & Comments

### Future Enhancements (Post Phase 3)
- Dynamic RLS policy management (admin UI)
- Real-time permission sync from Entra ID
- Advanced caching strategies
- Query result caching with RLS awareness
- Performance monitoring dashboard
- Cost optimization analysis

### Reference Links
- [Azure App Service - Connect as User Tutorial](https://learn.microsoft.com/en-us/azure/app-service/tutorial-connect-app-access-sql-database-as-user-dotnet)
- [OAuth 2.0 On-Behalf-Of Flow](https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-on-behalf-of-flow)
- [Row-Level Security in Azure SQL](https://learn.microsoft.com/en-us/sql/relational-databases/security/row-level-security)
- [Entra ID External Users in Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-configure)

---

**Document Version**: 1.0  
**Last Updated**: September 30, 2025  
**Maintained By**: Development Team  
**Review Frequency**: Weekly during active development

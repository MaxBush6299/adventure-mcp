-- Check SQL Permissions for Managed Identity
-- Connect to: adventureworks8700.database.windows.net/adventureworks
-- Use Azure AD authentication when connecting

-- ==========================================
-- 1. Check if the user exists
-- ==========================================
SELECT 
    name AS UserName,
    type_desc AS UserType,
    authentication_type_desc AS AuthType,
    CONVERT(VARCHAR(50), sid, 1) AS SID,
    create_date AS CreatedDate
FROM sys.database_principals
WHERE type = 'E' -- External user (Azure AD)
  AND name LIKE '%mssql-mcp-server%'
ORDER BY create_date DESC;

-- ==========================================
-- 2. Check role memberships for the user
-- ==========================================
SELECT 
    dp.name AS UserName,
    r.name AS RoleName,
    r.type_desc AS RoleType
FROM sys.database_principals dp
JOIN sys.database_role_members drm ON dp.principal_id = drm.member_principal_id
JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
WHERE dp.type = 'E' -- External user
  AND dp.name LIKE '%mssql-mcp-server%'
ORDER BY dp.name, r.name;

-- ==========================================
-- 3. Check specific Object ID
-- ==========================================
-- Replace with your managed identity's Object ID
DECLARE @ObjectId NVARCHAR(100) = 'f77c8218-86ff-4394-9ab0-0655b00029ab';

SELECT 
    name AS UserName,
    type_desc AS UserType,
    authentication_type_desc AS AuthType,
    CONVERT(VARCHAR(50), sid, 2) AS SID_HEX,
    create_date AS CreatedDate
FROM sys.database_principals
WHERE type = 'E'
  AND CONVERT(VARCHAR(100), sid, 2) = @ObjectId;

-- ==========================================
-- 4. List ALL external (Azure AD) users
-- ==========================================
SELECT 
    name AS UserName,
    type_desc AS UserType,
    authentication_type_desc AS AuthType,
    CONVERT(VARCHAR(50), sid, 2) AS ObjectId,
    create_date AS CreatedDate
FROM sys.database_principals
WHERE type = 'E' -- External user (Azure AD)
ORDER BY create_date DESC;

-- ==========================================
-- Expected Results:
-- ==========================================
-- If the user EXISTS, you'll see:
--   UserName: mssql-mcp-server-fresh (or similar)
--   UserType: EXTERNAL_USER
--   AuthType: INSTANCE (Azure AD)
--   ObjectId: f77c8218-86ff-4394-9ab0-0655b00029ab
--
-- Role memberships should include:
--   - db_datareader
--   - db_datawriter
--   - db_ddladmin
--
-- If the user DOES NOT EXIST, the queries will return no rows.

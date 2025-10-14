-- ================================================================
-- ADD CONTAINER MANAGED IDENTITY TO SQL DATABASE
-- ================================================================
-- 
-- Container: mssql-mcp-server-v2
-- Object ID: ff27b331-3073-449a-b5dc-fa9e46c21cf2
-- 
-- INSTRUCTIONS:
-- 1. Open SQL Server Management Studio (SSMS)
-- 2. Connect to: adventureworks8700.database.windows.net
-- 3. Select database: adventureworks
-- 4. Make sure you're logged in as an admin (your Azure AD account)
-- 5. Run this entire script
-- ================================================================

-- Step 1: Drop existing user if it exists
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mssql-mcp-server-v2')
BEGIN
    PRINT 'Dropping existing user: mssql-mcp-server-v2';
    DROP USER [mssql-mcp-server-v2];
END
ELSE
BEGIN
    PRINT 'No existing user found';
END
GO

-- Step 2: Create the managed identity user
-- The SID is the Object ID converted to binary format with 0x prefix
-- Object ID: ff27b331-3073-449a-b5dc-fa9e46c21cf2
-- Correct SID (with proper GUID byte ordering): 0x31b327ff73309a44b5dcfa9e46c21cf2
PRINT 'Creating managed identity user: mssql-mcp-server-v2';
CREATE USER [mssql-mcp-server-v2] WITH SID = 0x31b327ff73309a44b5dcfa9e46c21cf2, TYPE = E;
PRINT 'User created successfully';
GO

-- Step 3: Grant db_datareader role (read data from tables)
PRINT 'Granting db_datareader role...';
ALTER ROLE db_datareader ADD MEMBER [mssql-mcp-server-v2];
GO

-- Step 4: Grant db_datawriter role (insert, update, delete data)
PRINT 'Granting db_datawriter role...';
ALTER ROLE db_datawriter ADD MEMBER [mssql-mcp-server-v2];
GO

-- Step 5: Grant db_ddladmin role (create/drop tables and indexes)
PRINT 'Granting db_ddladmin role...';
ALTER ROLE db_ddladmin ADD MEMBER [mssql-mcp-server-v2];
GO

-- Step 6: Grant EXECUTE permission (run stored procedures)
PRINT 'Granting EXECUTE permission...';
GRANT EXECUTE TO [mssql-mcp-server-v2];
GO

-- Step 7: Grant VIEW DEFINITION (view schemas and metadata)
PRINT 'Granting VIEW DEFINITION permission...';
GRANT VIEW DEFINITION TO [mssql-mcp-server-v2];
GO

-- Step 8: Verify the user and permissions
PRINT '';
PRINT '================================================================';
PRINT 'VERIFICATION: User and Role Memberships';
PRINT '================================================================';
SELECT 
    dp.name AS UserName,
    dp.type_desc AS UserType,
    dp.authentication_type_desc AS AuthType,
    ISNULL(r.name, 'No role') AS RoleName
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members drm ON dp.principal_id = drm.member_principal_id
LEFT JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
WHERE dp.name = 'mssql-mcp-server-v2'
ORDER BY RoleName;

PRINT '';
PRINT '================================================================';
PRINT 'VERIFICATION: Direct Permissions';
PRINT '================================================================';
SELECT 
    dp.name AS UserName,
    perm.permission_name AS Permission,
    perm.state_desc AS State
FROM sys.database_permissions perm
INNER JOIN sys.database_principals dp ON perm.grantee_principal_id = dp.principal_id
WHERE dp.name = 'mssql-mcp-server-v2'
ORDER BY perm.permission_name;

PRINT '';
PRINT '================================================================';
PRINT 'SETUP COMPLETE!';
PRINT 'The managed identity should now be able to connect to SQL.';
PRINT 'Try calling a tool in Copilot Studio to test!';
PRINT '================================================================';
GO

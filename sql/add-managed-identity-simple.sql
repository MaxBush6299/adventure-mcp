-- ================================================================
-- ADD CONTAINER MANAGED IDENTITY TO SQL DATABASE (SIMPLE METHOD)
-- ================================================================
-- 
-- Container: mssql-mcp-server-v2
-- Object ID: ff27b331-3073-449a-b5dc-fa9e46c21cf2
-- 
-- This method uses FROM EXTERNAL PROVIDER which is much simpler!
-- ================================================================

-- Step 1: Drop existing user if it exists
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mssql-mcp-server-v2')
BEGIN
    PRINT 'Dropping existing user: mssql-mcp-server-v2';
    DROP USER [mssql-mcp-server-v2];
END
GO

-- Step 2: Create the managed identity user using FROM EXTERNAL PROVIDER
-- This automatically handles the SID conversion!
PRINT 'Creating managed identity user: mssql-mcp-server-v2';
CREATE USER [mssql-mcp-server-v2] FROM EXTERNAL PROVIDER;
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

-- Step 8: Grant CONNECT permission
PRINT 'Granting CONNECT permission...';
GRANT CONNECT TO [mssql-mcp-server-v2];
GO

-- Step 9: Verify the user and permissions
PRINT '';
PRINT '================================================================';
PRINT 'VERIFICATION: User and Role Memberships';
PRINT '================================================================';
SELECT 
    dp.name AS UserName,
    dp.type_desc AS UserType,
    dp.authentication_type_desc AS AuthType,
    CONVERT(VARCHAR(MAX), dp.sid, 1) AS SID_Hex,
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
PRINT 'Container Object ID: ff27b331-3073-449a-b5dc-fa9e46c21cf2';
PRINT '================================================================';
GO

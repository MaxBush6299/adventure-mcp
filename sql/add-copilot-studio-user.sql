-- ================================================================
-- ADD COPILOT STUDIO USER TO SQL DATABASE
-- ================================================================
-- 
-- User: System Administrator (admin@MngEnvMCAP095199.onmicrosoft.com)
-- Object ID: 4f0d74ba-7e68-48c7-8c7f-5d3e8dd05805
-- 
-- INSTRUCTIONS:
-- 1. Open SQL Server Management Studio (SSMS)
-- 2. Connect to: adventureworks8700.database.windows.net
-- 3. Select database: adventureworks
-- 4. Make sure you're logged in as an admin (your Azure AD account)
-- 5. Run this entire script
-- ================================================================

-- Step 1: Drop existing user if it exists
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'admin@MngEnvMCAP095199.onmicrosoft.com')
BEGIN
    PRINT 'Dropping existing user: admin@MngEnvMCAP095199.onmicrosoft.com';
    DROP USER [admin@MngEnvMCAP095199.onmicrosoft.com];
END
ELSE
BEGIN
    PRINT 'No existing user found';
END
GO

-- Step 2: Create the Azure AD user
-- The SID is the Object ID converted to binary format with 0x prefix
PRINT 'Creating Azure AD user: admin@MngEnvMCAP095199.onmicrosoft.com';
CREATE USER [admin@MngEnvMCAP095199.onmicrosoft.com] WITH SID = 0x4f0d74ba7e6848c78c7f5d3e8dd05805, TYPE = E;
PRINT 'User created successfully';
GO

-- Step 3: Grant db_datareader role (read data from tables)
PRINT 'Granting db_datareader role...';
ALTER ROLE db_datareader ADD MEMBER [admin@MngEnvMCAP095199.onmicrosoft.com];
GO

-- Step 4: Grant db_datawriter role (insert, update, delete data)
PRINT 'Granting db_datawriter role...';
ALTER ROLE db_datawriter ADD MEMBER [admin@MngEnvMCAP095199.onmicrosoft.com];
GO

-- Step 5: Grant db_ddladmin role (create/drop tables and indexes)
PRINT 'Granting db_ddladmin role...';
ALTER ROLE db_ddladmin ADD MEMBER [admin@MngEnvMCAP095199.onmicrosoft.com];
GO

-- Step 6: Grant EXECUTE permission (run stored procedures)
PRINT 'Granting EXECUTE permission...';
GRANT EXECUTE TO [admin@MngEnvMCAP095199.onmicrosoft.com];
GO

-- Step 7: Grant VIEW DEFINITION (view schemas and metadata)
PRINT 'Granting VIEW DEFINITION permission...';
GRANT VIEW DEFINITION TO [admin@MngEnvMCAP095199.onmicrosoft.com];
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
WHERE dp.name = 'admin@MngEnvMCAP095199.onmicrosoft.com'
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
WHERE dp.name = 'admin@MngEnvMCAP095199.onmicrosoft.com'
ORDER BY perm.permission_name;

PRINT '';
PRINT '================================================================';
PRINT 'SETUP COMPLETE!';
PRINT 'The Copilot Studio user can now execute tools!';
PRINT 'Try calling list_table in Copilot Studio to test!';
PRINT '================================================================';
GO

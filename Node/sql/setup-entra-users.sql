-- ========================================
-- Task 1.5: Create Azure SQL Entra ID Users and Groups
-- ========================================
--
-- PURPOSE: Set up Entra ID (Azure AD) authenticated users and groups
--          in Azure SQL Database for Row-Level Security implementation
--
-- PREREQUISITES:
--   1. Connected to Azure SQL as Entra ID administrator
--   2. Users/groups exist in Entra ID tenant
--   3. SQL Server firewall allows connections
--
-- HOW TO RUN:
--   - Azure Data Studio: Connect with Azure AD auth, run script
--   - sqlcmd: sqlcmd -S <server>.database.windows.net -d <db> -G -U <admin@domain.com> -i setup-entra-users.sql
--   - SSMS: Connect with Azure AD auth, execute script
--
-- AUTHOR: Development Team
-- DATE: October 1, 2025
-- ========================================

USE [adventureworks];  -- Replace with your database name
GO

PRINT '========================================';
PRINT 'Task 1.5: Entra ID Users Setup';
PRINT '========================================';
PRINT '';

-- ========================================
-- STEP 1: Verify Connection as Entra ID Admin
-- ========================================
PRINT 'Verifying connection...';
SELECT 
    USER_NAME() AS CurrentUser,
    ORIGINAL_LOGIN() AS LoginName,
    SYSTEM_USER AS SystemUser;

IF USER_NAME() = 'dbo'
BEGIN
    PRINT 'WARNING: You are connected as ''dbo'', not an Entra ID user.';
    PRINT 'This script should be run while connected as an Entra ID admin.';
    PRINT 'Connection type: SQL Authentication or not configured properly.';
    PRINT '';
    -- Don't exit, allow to continue for documentation purposes
END
ELSE
BEGIN
    PRINT 'Connected as: ' + USER_NAME();
    PRINT 'This appears to be an Entra ID connection.';
    PRINT '';
END
GO

-- ========================================
-- STEP 2: Create Individual Entra ID Users
-- ========================================
PRINT 'Creating individual Entra ID users...';
PRINT '';

-- IMPORTANT: Replace these email addresses with actual users from your Entra ID tenant
-- Format: CREATE USER [user@domain.com] FROM EXTERNAL PROVIDER;

-- Example users (commented out - uncomment and modify for your tenant)
-- CREATE USER [alice@contoso.com] FROM EXTERNAL PROVIDER;
-- CREATE USER [bob@contoso.com] FROM EXTERNAL PROVIDER;
-- CREATE USER [charlie@contoso.com] FROM EXTERNAL PROVIDER;

-- Template for adding your users:
-- CREATE USER [firstname.lastname@yourdomain.com] FROM EXTERNAL PROVIDER;

-- For testing, you can create yourself:
-- CREATE USER [your.email@yourdomain.com] FROM EXTERNAL PROVIDER;

PRINT 'NOTE: Individual users have been skipped (template provided above).';
PRINT 'Uncomment and modify the CREATE USER statements with actual email addresses.';
PRINT '';

-- ========================================
-- STEP 3: Create Entra ID Security Groups
-- ========================================
PRINT 'Creating Entra ID security groups...';
PRINT '';

-- IMPORTANT: Groups must exist in your Entra ID tenant
-- Use the exact Display Name from Entra ID

-- Example groups (commented out - uncomment if groups exist in your tenant)
-- CREATE USER [SalesTeam] FROM EXTERNAL PROVIDER;
-- CREATE USER [EngineeringTeam] FROM EXTERNAL PROVIDER;
-- CREATE USER [DataAnalysts] FROM EXTERNAL PROVIDER;
-- CREATE USER [Administrators] FROM EXTERNAL PROVIDER;

PRINT 'NOTE: Security groups have been skipped (template provided above).';
PRINT 'Uncomment and modify the CREATE USER statements with actual group names.';
PRINT '';

-- ========================================
-- STEP 4: Grant Basic Database Permissions
-- ========================================
PRINT 'Granting database permissions...';
PRINT '';

-- Grant read access to individual users
-- ALTER ROLE db_datareader ADD MEMBER [alice@contoso.com];
-- ALTER ROLE db_datareader ADD MEMBER [bob@contoso.com];

-- Grant read and write access
-- ALTER ROLE db_datareader ADD MEMBER [charlie@contoso.com];
-- ALTER ROLE db_datawriter ADD MEMBER [charlie@contoso.com];

-- Grant permissions to groups
-- ALTER ROLE db_datareader ADD MEMBER [SalesTeam];
-- ALTER ROLE db_datawriter ADD MEMBER [SalesTeam];

-- ALTER ROLE db_datareader ADD MEMBER [EngineeringTeam];
-- ALTER ROLE db_datawriter ADD MEMBER [EngineeringTeam];

PRINT 'NOTE: Permission grants have been skipped (template provided above).';
PRINT 'Uncomment the ALTER ROLE statements after creating users/groups.';
PRINT '';

-- ========================================
-- STEP 5: Create Custom Roles for RLS
-- ========================================
PRINT 'Creating custom database roles...';
PRINT '';

-- Create role for data owners (full access to their data)
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'DataOwners' AND type = 'R')
BEGIN
    CREATE ROLE DataOwners;
    GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO DataOwners;
    PRINT 'Created role: DataOwners';
END
ELSE
    PRINT 'Role already exists: DataOwners';

-- Create role for data viewers (read-only)
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'DataViewers' AND type = 'R')
BEGIN
    CREATE ROLE DataViewers;
    GRANT SELECT ON SCHEMA::dbo TO DataViewers;
    PRINT 'Created role: DataViewers';
END
ELSE
    PRINT 'Role already exists: DataViewers';

-- Create role for administrators (can bypass RLS later)
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'RLSAdministrators' AND type = 'R')
BEGIN
    CREATE ROLE RLSAdministrators;
    GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO RLSAdministrators;
    GRANT VIEW DATABASE STATE TO RLSAdministrators;
    PRINT 'Created role: RLSAdministrators';
END
ELSE
    PRINT 'Role already exists: RLSAdministrators';

PRINT '';

-- Assign users/groups to custom roles (examples)
-- ALTER ROLE DataOwners ADD MEMBER [alice@contoso.com];
-- ALTER ROLE DataOwners ADD MEMBER [EngineeringTeam];
-- ALTER ROLE DataViewers ADD MEMBER [DataAnalysts];
-- ALTER ROLE RLSAdministrators ADD MEMBER [Administrators];

-- ========================================
-- STEP 6: Verification Queries
-- ========================================
PRINT 'Verification: External users and groups';
PRINT '========================================';
PRINT '';

SELECT 
    dp.name AS PrincipalName,
    dp.type_desc AS PrincipalType,
    dp.authentication_type_desc AS AuthType,
    dp.create_date AS CreatedDate,
    dp.modify_date AS ModifiedDate
FROM sys.database_principals dp
WHERE dp.type IN ('E', 'X') -- E = External user, X = External group
  AND dp.name NOT LIKE '##%' -- Exclude system principals
ORDER BY dp.type_desc, dp.create_date DESC;

PRINT '';
PRINT 'Verification: Role memberships for external principals';
PRINT '========================================';
PRINT '';

SELECT 
    u.name AS MemberName,
    u.type_desc AS MemberType,
    r.name AS RoleName,
    r.type_desc AS RoleType
FROM sys.database_principals u
JOIN sys.database_role_members rm ON u.principal_id = rm.member_principal_id
JOIN sys.database_principals r ON rm.role_principal_id = r.principal_id
WHERE u.type IN ('E', 'X')
ORDER BY u.name, r.name;

PRINT '';
PRINT 'Verification: Custom roles created';
PRINT '========================================';
PRINT '';

SELECT 
    name AS RoleName,
    type_desc AS Type,
    create_date AS CreatedDate
FROM sys.database_principals
WHERE type = 'R'
  AND name IN ('DataOwners', 'DataViewers', 'RLSAdministrators')
ORDER BY name;

PRINT '';
PRINT '========================================';
PRINT 'Task 1.5 Setup Complete!';
PRINT '========================================';
PRINT '';
PRINT 'NEXT STEPS:';
PRINT '  1. Uncomment and modify CREATE USER statements with your tenant users/groups';
PRINT '  2. Run the script again to create the users/groups';
PRINT '  3. Uncomment and run the ALTER ROLE statements to grant permissions';
PRINT '  4. Verify users can connect with their Entra ID tokens';
PRINT '  5. Proceed to Task 1.6: Implement RLS Policies';
PRINT '';
PRINT 'TESTING:';
PRINT '  - Have a user connect using their Entra ID credentials';
PRINT '  - Run: SELECT USER_NAME() AS CurrentUser;';
PRINT '  - Should return their email address (e.g., alice@contoso.com)';
PRINT '';
PRINT 'TROUBLESHOOTING:';
PRINT '  - If CREATE USER fails: Verify user/group exists in Entra ID';
PRINT '  - If permission denied: Ensure you are connected as Entra ID admin';
PRINT '  - If user cannot connect: Grant at least db_datareader role';
PRINT '';
GO

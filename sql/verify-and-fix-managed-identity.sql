-- ================================================================
-- VERIFY AND FIX MANAGED IDENTITY PERMISSIONS
-- ================================================================
-- Run this in Azure Portal Query Editor for adventureworks database

-- Check if user exists
SELECT 'Current User Status' AS Info;
SELECT 
    name, 
    type_desc, 
    authentication_type_desc,
    CONVERT(VARCHAR(MAX), sid, 1) AS SID_Hex
FROM sys.database_principals 
WHERE name = 'mssql-mcp-server-v2';

-- If SID is wrong, drop and recreate
PRINT 'Dropping and recreating user with correct SID...';
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mssql-mcp-server-v2')
BEGIN
    DROP USER [mssql-mcp-server-v2];
END

-- Create with CORRECT SID
CREATE USER [mssql-mcp-server-v2] WITH SID = 0x31b327ff73309a44b5dcfa9e46c21cf2, TYPE = E;

-- Grant all necessary permissions
ALTER ROLE db_datareader ADD MEMBER [mssql-mcp-server-v2];
ALTER ROLE db_datawriter ADD MEMBER [mssql-mcp-server-v2];
ALTER ROLE db_ddladmin ADD MEMBER [mssql-mcp-server-v2];
GRANT EXECUTE TO [mssql-mcp-server-v2];
GRANT VIEW DEFINITION TO [mssql-mcp-server-v2];
GRANT CONNECT TO [mssql-mcp-server-v2];  -- IMPORTANT!

-- Verify
SELECT 'Verification Results' AS Info;
SELECT 
    dp.name AS UserName,
    dp.type_desc AS UserType,
    CONVERT(VARCHAR(MAX), dp.sid, 1) AS SID_Hex,
    r.name AS RoleName
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members drm ON dp.principal_id = drm.member_principal_id
LEFT JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
WHERE dp.name = 'mssql-mcp-server-v2'
ORDER BY RoleName;

PRINT 'Done! Expected SID: 0x31B327FF73309A44B5DCFA9E46C21CF2';

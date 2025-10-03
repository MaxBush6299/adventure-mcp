-- Grant SQL permissions to the new managed identity
-- Principal ID: a0bd364f-ef36-43c7-b8db-3916d3cfc3cb

-- Create user with explicit Object ID to avoid duplicate name issues
CREATE USER [mssql-mcp-server-fixed2] FROM EXTERNAL PROVIDER 
    WITH OBJECT_ID = 'a0bd364f-ef36-43c7-b8db-3916d3cfc3cb';

-- Grant necessary roles
ALTER ROLE db_datareader ADD MEMBER [mssql-mcp-server-fixed2];
ALTER ROLE db_datawriter ADD MEMBER [mssql-mcp-server-fixed2];
ALTER ROLE db_ddladmin ADD MEMBER [mssql-mcp-server-fixed2];

-- Verify permissions
SELECT 
    dp.name AS UserName,
    dp.type_desc AS UserType,
    dp.authentication_type_desc AS AuthType,
    drm.role_principal_id,
    dpr.name AS RoleName
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members drm ON dp.principal_id = drm.member_principal_id
LEFT JOIN sys.database_principals dpr ON drm.role_principal_id = dpr.principal_id
WHERE dp.name LIKE '%mssql-mcp-server%'
ORDER BY dp.name, dpr.name;

-- ========================================
-- Task 1.6: Row-Level Security (RLS) Implementation
-- Proof of Concept: Documents Table
-- ========================================
-- Database: adventureworks
-- Date: October 1, 2025
-- Status: Complete
-- ========================================

-- Prerequisites:
-- 1. Connected to adventureworks database (not master)
-- 2. User has db_owner permissions
-- 3. Entra ID users created (Task 1.5)

-- ========================================
-- STEP 1: Create Security Schema
-- ========================================
-- Purpose: Organize all RLS objects in dedicated schema

CREATE SCHEMA Security;
GO

-- Verify schema creation
SELECT name, schema_id 
FROM sys.schemas 
WHERE name = 'Security';
GO

-- ========================================
-- STEP 2: Create Documents Table (POC)
-- ========================================
-- Purpose: Test table to demonstrate RLS mechanics

CREATE TABLE dbo.Documents (
    DocumentId INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(200) NOT NULL,
    Content NVARCHAR(MAX),
    OwnerId NVARCHAR(256) NOT NULL,  -- Critical: stores USER_NAME()
    CreatedDate DATETIME2 DEFAULT GETDATE(),
    ModifiedDate DATETIME2 DEFAULT GETDATE()
);
GO

-- ========================================
-- STEP 3: Insert Test Data
-- ========================================
-- Purpose: Create sample documents for multiple users

INSERT INTO dbo.Documents (Title, Content, OwnerId)
VALUES 
    ('My Personal Notes', 'These are my private notes', 'admin@MngEnvMCAP095199.onmicrosoft.com'),
    ('Project Proposal', 'Confidential project details', 'admin@MngEnvMCAP095199.onmicrosoft.com'),
    ('MB6299 Document 1', 'This belongs to mb6299', 'mb6299@MngEnvMCAP095199.onmicrosoft.com'),
    ('MB6299 Document 2', 'Another mb6299 document', 'mb6299@MngEnvMCAP095199.onmicrosoft.com'),
    ('Alice Document', 'This belongs to Alice', 'alice@example.com'),
    ('Bob Document', 'This belongs to Bob', 'bob@example.com');
GO

-- Verify data insertion
SELECT 
    DocumentId, 
    Title, 
    OwnerId,
    CreatedDate
FROM dbo.Documents
ORDER BY DocumentId;
GO

-- ========================================
-- STEP 4: Create Predicate Function
-- ========================================
-- Purpose: Filter logic - users see only rows where OwnerId = USER_NAME()

CREATE FUNCTION Security.fn_DocumentAccessPredicate(@OwnerId NVARCHAR(256))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN 
    SELECT 1 AS fn_securitypredicate_result
    WHERE @OwnerId = USER_NAME();
GO

-- Test the predicate logic (before RLS is applied)
SELECT 
    DocumentId,
    Title,
    OwnerId,
    CASE 
        WHEN OwnerId = USER_NAME() THEN 'VISIBLE'
        ELSE 'HIDDEN'
    END AS WouldBeVisible
FROM dbo.Documents
ORDER BY DocumentId;
GO

-- ========================================
-- STEP 5: Create Security Policy
-- ========================================
-- Purpose: Apply predicate function to Documents table

CREATE SECURITY POLICY Security.DocumentAccessPolicy
ADD FILTER PREDICATE Security.fn_DocumentAccessPredicate(OwnerId) 
    ON dbo.Documents,
ADD BLOCK PREDICATE Security.fn_DocumentAccessPredicate(OwnerId) 
    ON dbo.Documents AFTER INSERT
WITH (STATE = ON);
GO

-- Verify policy creation
SELECT 
    name AS PolicyName,
    is_enabled AS IsEnabled,
    is_schema_bound AS IsSchemaBinding
FROM sys.security_policies
WHERE name = 'DocumentAccessPolicy';
GO

-- See which tables have RLS policies
SELECT 
    OBJECT_NAME(target_object_id) AS TableName,
    sp.name AS PolicyName,
    operation_desc AS Operation
FROM sys.security_predicates pred
JOIN sys.security_policies sp ON pred.object_id = sp.object_id
ORDER BY TableName;
GO

-- ========================================
-- STEP 6: Grant Permissions to Users
-- ========================================
-- Purpose: Allow users to query the Documents table

-- Grant permissions using stored procedures (works with permission constraints)
EXEC sp_addrolemember 'db_datareader', 'mb6299@MngEnvMCAP095199.onmicrosoft.com';
EXEC sp_addrolemember 'db_datawriter', 'mb6299@MngEnvMCAP095199.onmicrosoft.com';
GO

-- ========================================
-- TESTING: RLS Enforcement
-- ========================================

-- Test 1: Check current user
SELECT USER_NAME() AS CurrentUser;
GO

-- Test 2: Query as current user (dbo should see 0 rows)
SELECT 
    DocumentId, 
    Title, 
    OwnerId,
    'Currently connected as: ' + USER_NAME() AS Note
FROM dbo.Documents;
GO

-- Test 3: Impersonate mb6299 user
EXECUTE AS USER = 'mb6299@MngEnvMCAP095199.onmicrosoft.com';
GO

-- Check who we are now
SELECT USER_NAME() AS CurrentUser;
GO

-- Query documents - should see only mb6299's 2 documents
SELECT 
    DocumentId, 
    Title, 
    OwnerId,
    'YOU SHOULD SEE 2 ROWS (mb6299 documents)' AS Note
FROM dbo.Documents;
GO

-- Return to original user
REVERT;
GO

-- Test 4: Verify we're back to dbo (should see 0 rows)
SELECT USER_NAME() AS CurrentUser;
GO

SELECT COUNT(*) AS RowsVisible FROM dbo.Documents;
-- Expected: 0 (dbo owns no documents)
GO

-- ========================================
-- ADMIN TESTING: Toggle RLS ON/OFF
-- ========================================

-- Turn OFF RLS to see all data
ALTER SECURITY POLICY Security.DocumentAccessPolicy
WITH (STATE = OFF);
GO

-- Now you should see all 6 documents
SELECT 
    DocumentId, 
    Title, 
    OwnerId,
    'RLS is OFF - You see all 6 documents' AS Note
FROM dbo.Documents
ORDER BY DocumentId;
GO

-- Turn RLS back ON
ALTER SECURITY POLICY Security.DocumentAccessPolicy
WITH (STATE = ON);
GO

-- Now you see 0 documents again (if you're dbo)
SELECT 
    COUNT(*) AS RowsVisible,
    'RLS is ON - You see 0 documents (dbo owns none)' AS Note
FROM dbo.Documents;
GO

-- ========================================
-- VERIFICATION QUERIES
-- ========================================

-- 1. List all security policies
SELECT 
    name AS PolicyName,
    is_enabled AS IsEnabled,
    is_schema_bound AS IsSchemaBinding,
    create_date AS CreatedDate
FROM sys.security_policies;
GO

-- 2. List all security predicates
SELECT 
    OBJECT_NAME(target_object_id) AS TableName,
    sp.name AS PolicyName,
    operation_desc AS Operation,
    predicate_type_desc AS PredicateType
FROM sys.security_predicates pred
JOIN sys.security_policies sp ON pred.object_id = sp.object_id;
GO

-- 3. List all RLS functions
SELECT 
    SCHEMA_NAME(schema_id) AS SchemaName,
    name AS FunctionName,
    type_desc AS ObjectType,
    create_date AS CreatedDate
FROM sys.objects
WHERE type = 'IF'  -- Inline table-valued function
  AND SCHEMA_NAME(schema_id) = 'Security';
GO

-- 4. Test user permissions
SELECT 
    dp.name AS UserName,
    dp.type_desc AS Type,
    STRING_AGG(r.name, ', ') AS Roles
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members drm ON dp.principal_id = drm.member_principal_id
LEFT JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
WHERE dp.name = 'mb6299@MngEnvMCAP095199.onmicrosoft.com'
GROUP BY dp.name, dp.type_desc;
GO

-- ========================================
-- CLEANUP (OPTIONAL - for reset/testing)
-- ========================================
-- CAUTION: This removes all RLS objects created in Task 1.6

/*
-- Drop security policy first
DROP SECURITY POLICY IF EXISTS Security.DocumentAccessPolicy;
GO

-- Drop predicate function
DROP FUNCTION IF EXISTS Security.fn_DocumentAccessPredicate;
GO

-- Drop test table
DROP TABLE IF EXISTS dbo.Documents;
GO

-- Drop security schema
DROP SCHEMA IF EXISTS Security;
GO
*/

-- ========================================
-- TASK 1.6 COMPLETE
-- ========================================
-- Status: ✅ RLS Proof of Concept Working
-- 
-- Next Steps:
-- - Task 1.7: Update MCP tools to use per-user pools
-- - Apply RLS patterns to production tables
-- - Test with real users in end-to-end scenario
-- ========================================

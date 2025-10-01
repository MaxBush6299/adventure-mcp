/**
 * Test Suite for Task 1.7: MCP Tools with ToolContext
 * 
 * Tests per-user connection pooling and RLS enforcement
 * 
 * Prerequisites:
 * - HTTP server running with authentication enabled
 * - Documents table exists with RLS policies
 * - Test users: mb6299@MngEnvMCAP095199.onmicrosoft.com
 * - Valid Azure AD token for test user
 */

import http from 'http';

// Configuration
const SERVER_HOST = process.env.MCP_SERVER_HOST || 'localhost';
const SERVER_PORT = process.env.MCP_SERVER_PORT || 3000;
const BASE_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

// Test user token (must be provided via environment variable or command line)
const TEST_USER_TOKEN = process.env.TEST_USER_TOKEN || null;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'mb6299@MngEnvMCAP095199.onmicrosoft.com';

// Test results tracking
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

/**
 * Make HTTP request to MCP server
 */
function makeRequest(method, path, data, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * Call MCP tool via JSON-RPC
 */
async function callTool(toolName, toolArgs, token = null) {
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs
    },
    id: Date.now()
  };

  return await makeRequest('POST', '/mcp', request, token);
}

/**
 * Test runner
 */
async function runTest(name, testFn, skip = false) {
  results.total++;
  
  if (skip) {
    console.log(`⊘ SKIP: ${name}`);
    results.skipped++;
    results.tests.push({ name, status: 'skipped', error: null });
    return;
  }

  try {
    await testFn();
    console.log(`✓ PASS: ${name}`);
    results.passed++;
    results.tests.push({ name, status: 'passed', error: null });
  } catch (error) {
    console.error(`✗ FAIL: ${name}`);
    console.error(`  Error: ${error.message}`);
    results.failed++;
    results.tests.push({ name, status: 'failed', error: error.message });
  }
}

/**
 * Assertion helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Test: Health check endpoint
 */
async function testHealthCheck() {
  const response = await makeRequest('GET', '/health', null);
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  assert(response.body.status === 'ok', 'Health check should return ok status');
}

/**
 * Test: List tools endpoint
 */
async function testListTools() {
  const response = await makeRequest('POST', '/mcp', {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1
  });
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  assert(response.body.result, 'Should have result');
  assert(Array.isArray(response.body.result.tools), 'Should have tools array');
  assert(response.body.result.tools.length === 8, `Expected 8 tools, got ${response.body.result.tools.length}`);
}

/**
 * Test: ReadDataTool without authentication (backward compatibility)
 */
async function testReadDataWithoutAuth() {
  const response = await callTool('read_data', {
    query: 'SELECT TOP 5 * FROM Security.Documents'
  });
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  assert(response.body.result, 'Should have result');
  
  // Parse the result content
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Rows returned (no auth): ${result.rows?.length || 0}`);
  assert(result.success === true, 'Query should succeed');
  
  // Without auth, should use dbo account which sees 0 rows due to RLS
  assert(result.rows.length === 0, `Expected 0 rows (dbo has no access), got ${result.rows.length}`);
}

/**
 * Test: ReadDataTool with authentication (RLS filtering)
 */
async function testReadDataWithAuth() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  const response = await callTool('read_data', {
    query: 'SELECT * FROM Security.Documents ORDER BY DocumentID'
  }, TEST_USER_TOKEN);
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  assert(response.body.result, 'Should have result');
  
  // Parse the result content
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Rows returned (authenticated as ${TEST_USER_EMAIL}): ${result.rows?.length || 0}`);
  assert(result.success === true, 'Query should succeed');
  
  // mb6299 should see 2 documents (DocumentID 1 and 2)
  assert(result.rows.length === 2, `Expected 2 rows for ${TEST_USER_EMAIL}, got ${result.rows.length}`);
  
  // Verify the documents belong to the user
  const owners = result.rows.map(row => row.Owner);
  assert(owners.every(owner => owner === TEST_USER_EMAIL), 
    `All documents should belong to ${TEST_USER_EMAIL}`);
  
  console.log(`  → Document IDs: ${result.rows.map(r => r.DocumentID).join(', ')}`);
}

/**
 * Test: InsertDataTool with authentication (RLS BLOCK predicate)
 */
async function testInsertDataWithAuth() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  // Try to insert a document for the authenticated user
  const testDocName = `Test_Doc_${Date.now()}`;
  
  const response = await callTool('insert_data', {
    tableName: 'Security.Documents',
    data: {
      DocumentName: testDocName,
      Content: 'Test content from Task 1.7 test',
      Owner: TEST_USER_EMAIL
    }
  }, TEST_USER_TOKEN);
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Insert result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  assert(result.success === true, 'Insert should succeed for own document');
  
  // Clean up - delete the test document
  try {
    await callTool('update_data', {
      tableName: 'Security.Documents',
      updates: { Content: '[DELETED]' },
      where: `DocumentName = '${testDocName}'`
    }, TEST_USER_TOKEN);
  } catch (e) {
    console.log(`  → Cleanup warning: ${e.message}`);
  }
}

/**
 * Test: InsertDataTool trying to insert for different owner (should fail)
 */
async function testInsertDataBlockPredicate() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  // Try to insert a document claiming a different owner (RLS should block this)
  const testDocName = `Malicious_Doc_${Date.now()}`;
  
  const response = await callTool('insert_data', {
    tableName: 'Security.Documents',
    data: {
      DocumentName: testDocName,
      Content: 'Attempting to insert as different user',
      Owner: 'attacker@example.com'  // Different owner - should be blocked by RLS
    }
  }, TEST_USER_TOKEN);
  
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Insert as different owner: ${result.success ? 'ALLOWED (BAD!)' : 'BLOCKED (GOOD!)'}`);
  
  // RLS BLOCK predicate should prevent this insert
  assert(result.success === false, 'Insert with different owner should be blocked by RLS');
  assert(result.message?.includes('blocked') || result.message?.includes('failed'), 
    'Error message should indicate operation was blocked');
}

/**
 * Test: UpdateDataTool with authentication (RLS filtering)
 */
async function testUpdateDataWithAuth() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  // Update one of the user's documents
  const response = await callTool('update_data', {
    tableName: 'Security.Documents',
    updates: { Content: `Updated by Task 1.7 test at ${new Date().toISOString()}` },
    where: 'DocumentID = 1'
  }, TEST_USER_TOKEN);
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Update result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  assert(result.success === true, 'Update should succeed for own document');
}

/**
 * Test: ListTableTool with authentication
 */
async function testListTablesWithAuth() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  const response = await callTool('list_table', {
    parameters: ['Security']  // Filter to Security schema
  }, TEST_USER_TOKEN);
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Tables in Security schema: ${result.items?.length || 0}`);
  assert(result.success === true, 'List tables should succeed');
  assert(result.items.length > 0, 'Should find at least one table in Security schema');
  
  // Check if Documents table is listed
  const tables = result.items.map(item => item['']);
  assert(tables.some(t => t.includes('Documents')), 'Should list Security.Documents table');
}

/**
 * Test: DescribeTableTool with authentication
 */
async function testDescribeTableWithAuth() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  const response = await callTool('describe_table', {
    tableName: 'Documents'
  }, TEST_USER_TOKEN);
  
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  
  const content = response.body.result.content[0].text;
  const result = JSON.parse(content);
  
  console.log(`  → Columns in Documents table: ${result.columns?.length || 0}`);
  assert(result.success === true, 'Describe table should succeed');
  assert(result.columns.length > 0, 'Should have columns');
  
  // Verify expected columns
  const columnNames = result.columns.map(c => c.name);
  assert(columnNames.includes('DocumentID'), 'Should have DocumentID column');
  assert(columnNames.includes('Owner'), 'Should have Owner column');
}

/**
 * Test: Multiple concurrent requests (pool isolation)
 */
async function testConcurrentRequests() {
  if (!TEST_USER_TOKEN) {
    throw new Error('TEST_USER_TOKEN not provided - cannot test authenticated mode');
  }

  console.log('  → Testing concurrent requests...');
  
  // Make 5 concurrent requests
  const promises = Array(5).fill(0).map((_, i) => 
    callTool('read_data', {
      query: 'SELECT COUNT(*) as count FROM Security.Documents'
    }, TEST_USER_TOKEN)
  );
  
  const responses = await Promise.all(promises);
  
  // All should succeed
  responses.forEach((response, i) => {
    assert(response.status === 200, `Request ${i+1} failed with status ${response.status}`);
  });
  
  console.log(`  → All ${responses.length} concurrent requests succeeded`);
}

/**
 * Main test execution
 */
async function main() {
  console.log('\n========================================');
  console.log('Task 1.7: MCP Tools with ToolContext');
  console.log('Integration Test Suite');
  console.log('========================================\n');
  console.log(`Server: ${BASE_URL}`);
  console.log(`Test User: ${TEST_USER_EMAIL}`);
  console.log(`Authentication: ${TEST_USER_TOKEN ? 'ENABLED' : 'DISABLED (limited tests)'}`);
  console.log('\n');

  // Check if token is provided
  const hasToken = !!TEST_USER_TOKEN;
  if (!hasToken) {
    console.log('⚠️  WARNING: TEST_USER_TOKEN not provided');
    console.log('   Many tests will be skipped.');
    console.log('   Set TEST_USER_TOKEN environment variable for full test coverage.\n');
  }

  // Run tests
  console.log('Running tests...\n');
  
  await runTest('1. Health check', testHealthCheck);
  await runTest('2. List tools', testListTools);
  await runTest('3. ReadData without auth (backward compat)', testReadDataWithoutAuth);
  await runTest('4. ReadData with auth (RLS filtering)', testReadDataWithAuth, !hasToken);
  await runTest('5. InsertData with auth (own document)', testInsertDataWithAuth, !hasToken);
  await runTest('6. InsertData with auth (block different owner)', testInsertDataBlockPredicate, !hasToken);
  await runTest('7. UpdateData with auth', testUpdateDataWithAuth, !hasToken);
  await runTest('8. ListTables with auth', testListTablesWithAuth, !hasToken);
  await runTest('9. DescribeTable with auth', testDescribeTableWithAuth, !hasToken);
  await runTest('10. Concurrent requests (pool isolation)', testConcurrentRequests, !hasToken);

  // Print summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`Total:   ${results.total}`);
  console.log(`Passed:  ${results.passed} ✓`);
  console.log(`Failed:  ${results.failed} ✗`);
  console.log(`Skipped: ${results.skipped} ⊘`);
  console.log('========================================\n');

  if (results.failed > 0) {
    console.log('Failed tests:');
    results.tests.filter(t => t.status === 'failed').forEach(t => {
      console.log(`  - ${t.name}: ${t.error}`);
    });
    console.log('');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  }
}

// Run tests
main().catch(error => {
  console.error('\n❌ Test suite failed:');
  console.error(error);
  process.exit(1);
});

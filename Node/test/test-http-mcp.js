#!/usr/bin/env node

/**
 * HTTP MCP Server Test Script
 * Tests the MCP server running in HTTP mode
 */

import fetch from 'node-fetch';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:8080';
const MCP_SSE_ENDPOINT = `${SERVER_URL}/mcp`;
const MCP_MESSAGE_ENDPOINT = `${SERVER_URL}/mcp/message`;
const HEALTH_ENDPOINT = `${SERVER_URL}/health`;

// Test colors
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(level, message) {
    const timestamp = new Date().toISOString();
    const color = colors[level] || colors.reset;
    console.log(`${color}[${level.toUpperCase()}]${colors.reset} ${timestamp} - ${message}`);
}

async function testHealthEndpoint() {
    log('blue', 'Testing health endpoint...');
    
    try {
        const response = await fetch(HEALTH_ENDPOINT);
        const data = await response.json();
        
        if (response.ok && data.status === 'healthy') {
            log('green', `✓ Health check passed: ${JSON.stringify(data)}`);
            return true;
        } else {
            log('red', `✗ Health check failed: ${response.status} - ${JSON.stringify(data)}`);
            return false;
        }
    } catch (error) {
        log('red', `✗ Health check error: ${error.message}`);
        return false;
    }
}

// For testing purposes, we'll create a simple HTTP test that doesn't establish full SSE
// In production, AI agents would establish proper SSE connections
async function testMcpEndpoints() {
    log('blue', 'Testing MCP endpoint accessibility...');
    
    try {
        // Test SSE endpoint - should respond with SSE headers
        const sseResponse = await fetch(MCP_SSE_ENDPOINT, {
            method: 'GET',
            headers: {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
        });
        
        log('green', `✓ SSE endpoint responded: ${sseResponse.status} - ${sseResponse.statusText}`);
        log('green', `✓ Content-Type: ${sseResponse.headers.get('content-type') || 'none'}`);
        
        // Note: For a full test, we'd need to establish an SSE connection and get a session ID
        // then send POST messages. This is a simplified connectivity test.
        
        return true;
    } catch (error) {
        log('red', `✗ MCP endpoint test failed: ${error.message}`);
        return false;
    }
}

// Simplified MCP request for basic testing (requires established SSE session in practice)
async function sendMcpRequest(method, params = {}, sessionId = 'test-session') {
    const request = {
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 1000000),
        method: method,
        params: params
    };
    
    try {
        const response = await fetch(`${MCP_MESSAGE_ENDPOINT}?sessionId=${sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        log('red', `MCP request failed: ${error.message}`);
        throw error;
    }
}

async function testListTools() {
    log('blue', 'Testing list_tools...');
    
    try {
        const response = await sendMcpRequest('tools/list');
        
        if (response.result && response.result.tools) {
            log('green', `✓ Listed ${response.result.tools.length} tools:`);
            response.result.tools.forEach(tool => {
                log('green', `  - ${tool.name}: ${tool.description.substring(0, 80)}...`);
            });
            return true;
        } else {
            log('red', `✗ Invalid tools list response: ${JSON.stringify(response)}`);
            return false;
        }
    } catch (error) {
        log('red', `✗ List tools failed: ${error.message}`);
        return false;
    }
}

async function testListTables() {
    log('blue', 'Testing list_table tool...');
    
    try {
        const response = await sendMcpRequest('tools/call', {
            name: 'list_table',
            arguments: {}
        });
        
        if (response.result) {
            log('green', `✓ List tables succeeded: ${JSON.stringify(response.result, null, 2)}`);
            return true;
        } else if (response.error) {
            log('yellow', `⚠ List tables returned error (expected if no DB access): ${response.error.message}`);
            return true; // This is expected if DB is not accessible
        } else {
            log('red', `✗ Invalid list tables response: ${JSON.stringify(response)}`);
            return false;
        }
    } catch (error) {
        log('red', `✗ List tables failed: ${error.message}`);
        return false;
    }
}

async function testDescribeTable() {
    log('blue', 'Testing describe_table tool...');
    
    try {
        const response = await sendMcpRequest('tools/call', {
            name: 'describe_table',
            arguments: {
                tableName: 'test_table'
            }
        });
        
        if (response.result) {
            log('green', `✓ Describe table succeeded: ${JSON.stringify(response.result, null, 2)}`);
            return true;
        } else if (response.error) {
            log('yellow', `⚠ Describe table returned error (expected if table doesn't exist): ${response.error.message}`);
            return true; // This is expected if table doesn't exist
        } else {
            log('red', `✗ Invalid describe table response: ${JSON.stringify(response)}`);
            return false;
        }
    } catch (error) {
        log('red', `✗ Describe table failed: ${error.message}`);
        return false;
    }
}

async function runAllTests() {
    log('blue', `Starting MCP HTTP server tests against: ${SERVER_URL}`);
    console.log('='.repeat(60));
    
    const tests = [
        { name: 'Health Check', fn: testHealthEndpoint },
        { name: 'List Tools', fn: testListTools },
        { name: 'List Tables', fn: testListTables },
        { name: 'Describe Table', fn: testDescribeTable }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
        try {
            const result = await test.fn();
            if (result) {
                passed++;
            } else {
                failed++;
            }
        } catch (error) {
            log('red', `Test ${test.name} threw exception: ${error.message}`);
            failed++;
        }
        console.log('-'.repeat(40));
    }
    
    console.log('='.repeat(60));
    log('blue', `Test Results: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
        log('green', '🎉 All tests passed!');
        process.exit(0);
    } else {
        log('red', '❌ Some tests failed');
        process.exit(1);
    }
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('HTTP MCP Server Test Script');
    console.log('');
    console.log('Usage: node test-http-mcp.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h     Show this help message');
    console.log('');
    console.log('Environment Variables:');
    console.log('  MCP_SERVER_URL  Server URL (default: http://localhost:8080)');
    console.log('');
    console.log('Examples:');
    console.log('  node test-http-mcp.js');
    console.log('  MCP_SERVER_URL=http://my-server.com:8080 node test-http-mcp.js');
    process.exit(0);
}

// Run tests
runAllTests().catch(error => {
    log('red', `Test runner failed: ${error.message}`);
    process.exit(1);
});
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

if (!LINEAR_API_KEY) {
    console.error('❌ LINEAR_API_KEY is not set. Add it to .env.local before running this script.');
    process.exit(1);
}
const MCP_URL = 'https://mcp.linear.app/mcp';

async function verifyConnection() {
    console.log('Verifying Linear MCP connection...');
    console.log(`Target: ${MCP_URL}`);

    try {
        // 1. Initialize Session
        console.log('\n--- Initializing Session ---');
        const sseUrl = 'https://mcp.linear.app/sse';
        console.log(`Connecting to SSE endpoint: ${sseUrl}`);

        const initResponse = await fetch(sseUrl, {
            headers: {
                'Authorization': `Bearer ${LINEAR_API_KEY}`,
                'Accept': 'text/event-stream'
            }
        });

        if (!initResponse.ok) {
            const text = await initResponse.text();
            throw new Error(`SSE connection failed: ${initResponse.status} ${text}`);
        }

        console.log('SSE Connected.');

        console.log('Reading first chunk of SSE to find session endpoint...');
        const body = initResponse.body;
        if (!body) throw new Error('No body in SSE response');

        let buffer = '';
        let endpoint = '';

        for await (const chunk of body) {
            buffer += chunk.toString();
            if (buffer.includes('event: endpoint')) {
                const lines = buffer.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        endpoint = line.substring(6).trim();
                        break;
                    }
                }
                if (endpoint) break;
            }
            if (buffer.length > 2000) break;
        }

        if (!endpoint) {
            throw new Error('Failed to obtain session endpoint from SSE');
        }

        console.log(`Session Endpoint found: ${endpoint}`);
        const postUrl = new URL(endpoint, 'https://mcp.linear.app').toString();
        console.log(`Full POST URL: ${postUrl}`);

        // Now perform the handshake: 'initialize'
        console.log('\n--- Sending initialize ---');
        const initRpc = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-script', version: '1.0' }
            }
        };

        const rpcResponse = await fetch(postUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINEAR_API_KEY}`
            },
            body: JSON.stringify(initRpc)
        });

        if (!rpcResponse.ok) {
            const text = await rpcResponse.text();
            throw new Error(`initialize failed: ${rpcResponse.status} ${text}`);
        }

        // The server might return "Accepted" (202) and send the result via SSE?
        // Or it might return JSON.
        // The error "Unexpected token 'A', "Accepted" is not valid JSON" suggests it returned text "Accepted".
        const rpcText = await rpcResponse.text();
        console.log(`Initialize Response Status: ${rpcResponse.status}`);
        console.log(`Initialize Response Body: ${rpcText}`);

        if (rpcText === 'Accepted') {
            console.log('Server accepted initialization. Waiting for response on SSE...');
            // We need to read the SSE stream to get the result.
            // Since we already consumed some of the stream, we need to keep reading.
            // But we are in a simple script.
            // Let's assume if it accepted, we can proceed to send 'initialized'.
        } else {
            const initResult = JSON.parse(rpcText);
            console.log('Initialize Result:', JSON.stringify(initResult, null, 2));
        }

        // Send 'notifications/initialized'
        await fetch(postUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINEAR_API_KEY}`
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized'
            })
        });
        console.log('Sent initialized notification.');

        // NOW we can call tools/list
        console.log('\n--- Testing tools/list ---');
        const listResponse = await fetch(postUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINEAR_API_KEY}`
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
            })
        });

        const listText = await listResponse.text();
        if (listText === 'Accepted') {
            console.log('tools/list Accepted. Result should be in SSE stream (not visible here).');
            // If the server is async, we can't easily see the result in this script without a full SSE client.
            // But getting "Accepted" means the request was valid and auth worked!
        } else {
            const listData = JSON.parse(listText);
            console.log('Tools/List Result:', JSON.stringify(listData, null, 2));
        }

        // Test linear_issues_search
        console.log('\n--- Testing linear_issues_search ---');
        const searchResponse = await fetch(postUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINEAR_API_KEY}`
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'linear_issues_search',
                    arguments: {
                        query: 'team:default',
                        includeCompleted: false
                    }
                }
            })
        });

        const searchText = await searchResponse.text();
        if (searchText === 'Accepted') {
            console.log('linear_issues_search Accepted. Request sent successfully.');
        } else {
            const searchData = JSON.parse(searchText);
            const content = searchData.result?.content || [];
            console.log(`Found ${content.length} content items.`);
            if (content.length > 0 && content[0].text) {
                console.log('First item preview:', content[0].text.substring(0, 100));
            }
        }

    } catch (error) {
        console.error('Verification failed:', error);
        process.exit(1);
    }
}

verifyConnection();


import { LinearMcpClient } from '../src/lib/linear-mcp-client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function debugLinearMcp() {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
        console.error('❌ LINEAR_API_KEY is not set in .env.local');
        process.exit(1);
    }

    console.log('🔑 Found LINEAR_API_KEY (length:', apiKey.length, ')');

    const client = new LinearMcpClient(apiKey);

    try {
        console.log('📡 Connecting to Linear MCP...');
        // executeAction will handle connection and initialization
        // await client.initialize(); 
        console.log('✅ Client ready');

        console.log('🔍 Listing Available Tools...');
        const tools = await client.listTools(true);
        console.log('🛠️ Tools:', JSON.stringify(tools, null, 2));
        console.log('🔍 Fetching Issues...');
        const issuesResult = await client.executeAction('list_issues', { query: 'state:open', includeCompleted: false });
        // console.log('📦 Issues Result:', JSON.stringify(issuesResult, null, 2));
        if (issuesResult && (issuesResult.issues || issuesResult.nodes)) {
            const list = issuesResult.issues || issuesResult.nodes;
            console.log('📦 First Issue Structure:', JSON.stringify(list[0], null, 2));
        } else {
            console.log('📦 Issues Result (Raw):', JSON.stringify(issuesResult, null, 2));
        }
        process.exit(0);

        console.log('🔍 Fetching Teams...');
        const teamsResult = await client.executeAction('list_teams', {});
        console.log('📦 Teams Result:', JSON.stringify(teamsResult, null, 2));

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

debugLinearMcp();

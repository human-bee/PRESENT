import { NextRequest, NextResponse } from 'next/server';
import { runLinearStewardFast } from '@/lib/agents/subagents/linear-steward-fast';
import { LinearMcpClient } from '@/lib/linear-mcp-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { instruction, context, apiKey, execute } = body;

        if (!instruction) {
            return NextResponse.json({ error: 'Missing instruction' }, { status: 400 });
        }

        const action = await runLinearStewardFast({ instruction, context: context || {} });

        // If execute flag is set and we have an API key, execute the MCP tool
        if (execute && apiKey && action.mcpTool) {
            const client = new LinearMcpClient(apiKey);
            const result = await client.executeTool(action.mcpTool.name, action.mcpTool.args);
            return NextResponse.json({ action, result, executed: true });
        }

        return NextResponse.json(action);
    } catch (error) {
        console.error('[API] Linear Steward failed:', error);
        return NextResponse.json(
            { kind: 'noOp', reason: 'Error processing instruction', mcpTool: null },
            { status: 500 }
        );
    }
}

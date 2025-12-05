import { NextRequest, NextResponse } from 'next/server';
import { runLinearStewardFast } from '@/lib/agents/subagents/linear-steward-fast';

export const runtime = 'nodejs'; // Agents SDK might need Node runtime, or Edge if compatible.
// flowchart-steward-fast uses 'process.env' so Node is safer.

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { instruction, context } = body;

        if (!instruction) {
            return NextResponse.json({ error: 'Missing instruction' }, { status: 400 });
        }

        const action = await runLinearStewardFast({ instruction, context: context || {} });

        return NextResponse.json(action);
    } catch (error) {
        console.error('[API] Linear Steward failed:', error);
        return NextResponse.json(
            { tool: 'linear_issues_search', params: { query: 'Error processing instruction' } },
            { status: 500 }
        );
    }
}

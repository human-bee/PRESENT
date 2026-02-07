import { NextRequest, NextResponse } from 'next/server';
import { runLinearStewardFast } from '@/lib/agents/subagents/linear-steward-fast';

export const runtime = 'nodejs'; // Agents SDK might need Node runtime, or Edge if compatible.
// flowchart-steward-fast uses 'process.env' so Node is safer.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { instruction, context, room } = body;

    if (!instruction) {
      return NextResponse.json({ status: 'error', error: 'Missing instruction' }, { status: 400 });
    }

    const action = await runLinearStewardFast({ instruction, context: context || {}, room });

    return NextResponse.json({ status: 'ok', action });
  } catch (error) {
    console.error('[LinearSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

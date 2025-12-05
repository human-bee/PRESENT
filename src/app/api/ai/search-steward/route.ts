import { NextRequest, NextResponse } from 'next/server';
import { runSearchSteward } from '@/lib/agents/subagents/search-steward';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, params } = body;

    if (!task) {
      return NextResponse.json(
        { status: 'error', error: 'Missing task' },
        { status: 400 }
      );
    }

    const result = await runSearchSteward({ task, params: params || {} });

    return NextResponse.json({ status: 'ok', result });
  } catch (error) {
    console.error('[SearchSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

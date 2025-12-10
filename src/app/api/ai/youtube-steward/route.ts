import { NextRequest, NextResponse } from 'next/server';
import { runYouTubeSteward } from '@/lib/agents/subagents/youtube-steward';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { instruction, context } = body;

    if (!instruction) {
      return NextResponse.json(
        { status: 'error', error: 'Missing instruction' },
        { status: 400 }
      );
    }

    const action = await runYouTubeSteward({ instruction, context });

    return NextResponse.json({ status: 'ok', action });
  } catch (error) {
    console.error('[YouTubeSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}






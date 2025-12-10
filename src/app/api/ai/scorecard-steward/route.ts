import { NextRequest, NextResponse } from 'next/server';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, room, componentId, intent, summary, prompt } = body;

    // Route fact_check to the full SOTA steward, other tasks to fast
    const useFast = task !== 'scorecard.fact_check';

    let result;
    if (useFast) {
      result = await runDebateScorecardStewardFast({
        room,
        componentId,
        intent,
        summary,
        prompt,
      });
    } else {
      result = await runDebateScorecardSteward({
        room,
        componentId,
        intent,
        summary,
        prompt,
      });
    }

    return NextResponse.json({ status: 'ok', result });
  } catch (error) {
    console.error('[ScorecardSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}






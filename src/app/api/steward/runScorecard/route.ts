import { NextRequest, NextResponse, after } from 'next/server';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';

export async function POST(req: NextRequest) {
  try {
    const { room, componentId, windowMs, summary, prompt, intent } = await req.json();

    if (typeof room !== 'string' || !room.trim()) {
      return NextResponse.json({ error: 'Missing or invalid room' }, { status: 400 });
    }

    if (typeof componentId !== 'string' || !componentId.trim()) {
      return NextResponse.json({ error: 'Missing or invalid componentId' }, { status: 400 });
    }

    const trimmedRoom = room.trim();
    const trimmedComponentId = componentId.trim();
    const resolvedWindow =
      windowMs === undefined || windowMs === null ? undefined : Number(windowMs);
    if (resolvedWindow !== undefined && Number.isNaN(resolvedWindow)) {
      return NextResponse.json({ error: 'Invalid windowMs value' }, { status: 400 });
    }

    const normalizedSummary =
      typeof summary === 'string' && summary.trim().length > 0 ? summary.trim().slice(0, 240) : undefined;
    const normalizedPrompt =
      typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
    const normalizedIntent =
      typeof intent === 'string' && intent.trim().length > 0 ? intent.trim() : undefined;

    after(async () => {
      try {
        console.log('[Steward][runScorecard] scheduled', {
          room: trimmedRoom,
          componentId: trimmedComponentId,
          windowMs: resolvedWindow,
          summary: normalizedSummary,
          intent: normalizedIntent,
        });
        await runDebateScorecardSteward({
          room: trimmedRoom,
          componentId: trimmedComponentId,
          windowMs: resolvedWindow,
          summary: normalizedSummary,
          prompt: normalizedPrompt,
          intent: normalizedIntent,
        });
        console.log('[Steward][runScorecard] completed', {
          room: trimmedRoom,
          componentId: trimmedComponentId,
          windowMs: resolvedWindow,
          summary: normalizedSummary,
          intent: normalizedIntent,
        });
      } catch (error) {
        console.error('[Steward][runScorecard] error', {
          room: trimmedRoom,
          componentId: trimmedComponentId,
          windowMs: resolvedWindow,
          summary: normalizedSummary,
          intent: normalizedIntent,
          error,
        });
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error) {
    console.error('Invalid request to steward/runScorecard', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}

import { NextRequest, NextResponse, after } from 'next/server';
import { runFlowchartSteward } from '@/lib/agents/subagents/flowchart-steward';

export async function POST(req: NextRequest) {
  try {
    const { room, docId, windowMs } = await req.json();

    if (typeof room !== 'string' || typeof docId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid room/docId' }, { status: 400 });
    }

    const trimmedRoom = room.trim();
    const trimmedDocId = docId.trim();
    if (!trimmedRoom || !trimmedDocId) {
      return NextResponse.json({ error: 'Missing or invalid room/docId' }, { status: 400 });
    }

    const resolvedWindow = windowMs === undefined ? undefined : Number(windowMs);
    if (resolvedWindow !== undefined && Number.isNaN(resolvedWindow)) {
      return NextResponse.json({ error: 'Invalid windowMs value' }, { status: 400 });
    }

    after(async () => {
      try {
        console.log('[Steward][run] scheduled', {
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
        });
        await runFlowchartSteward({ room: trimmedRoom, docId: trimmedDocId, windowMs: resolvedWindow });
        console.log('[Steward][run] completed', {
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
        });
      } catch (error) {
        console.error('[Steward][run] error', {
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
          error,
        });
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error) {
    console.error('Invalid request to steward/run', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}

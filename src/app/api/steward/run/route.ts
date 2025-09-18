import { NextRequest, NextResponse } from 'next/server';
import { runFlowchartSteward } from '@/lib/agents/subagents/flowchart-steward';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const roomRaw = typeof body?.room === 'string' ? body.room : undefined;
    const docRaw = typeof body?.docId === 'string' ? body.docId : undefined;
    const windowMsRaw = typeof body?.windowMs === 'number' ? body.windowMs : undefined;

    const room = roomRaw?.trim();
    const docId = docRaw?.trim();
    if (!room || !docId) {
      return NextResponse.json({ error: 'room and docId are required' }, { status: 400 });
    }

    const windowMs = windowMsRaw ? Math.max(1000, Math.min(600000, windowMsRaw)) : undefined;

    // Kick off steward run asynchronously to avoid holding the HTTP response
    void runFlowchartSteward({ room, docId, windowMs })
      .then((result) => {
        try {
          console.log('[Steward][run] completed', { room, docId, result });
        } catch {}
      })
      .catch((error) => {
        try {
          console.error('[Steward][run] failed', { room, docId, error });
        } catch {}
      });

    return NextResponse.json({ ok: true, status: 'queued' });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
}

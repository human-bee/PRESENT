import { NextRequest, NextResponse } from 'next/server';
import { recordAck } from '@/server/inboxes/ack';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = String(body?.sessionId || '').trim();
    const seq = Number(body?.seq);
    if (!sessionId || !Number.isFinite(seq)) {
      return NextResponse.json({ error: 'Invalid ack' }, { status: 400 });
    }
    recordAck(sessionId, seq);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}



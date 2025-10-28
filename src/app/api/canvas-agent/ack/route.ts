import { NextRequest, NextResponse } from 'next/server';
import { recordAck } from '@/server/inboxes/ack';
import { verifyAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = String(body?.sessionId || '').trim();
    const seq = Number(body?.seq);
    const clientId = String(body?.clientId || '').trim();
    const ts = Number(body?.ts);
    const roomId = String(body?.roomId || '').trim();
    const token = typeof body?.token === 'string' ? body.token : undefined;
    if (!sessionId || !Number.isFinite(seq)) {
      return NextResponse.json({ error: 'Invalid ack' }, { status: 400 });
    }
    const authorized = verifyAgentToken(token, { sessionId, roomId });
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    recordAck(sessionId, seq, clientId || 'unknown', Number.isFinite(ts) ? ts : Date.now());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { recordAck } from '@/server/inboxes/ack';
import { verifyAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';
import { recordAgentTraceEvent } from '@/lib/agents/shared/trace-events';

const REQUIRE_AGENT_TOKEN = process.env.CANVAS_AGENT_REQUIRE_TOKEN === 'true';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const normalizeOptional = (value: unknown) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };
    const sessionId = String(body?.sessionId || '').trim();
    const seq = Number(body?.seq);
    const clientId = String(body?.clientId || '').trim();
    const ts = Number(body?.ts);
    const roomId = String(body?.roomId || '').trim();
    const token = typeof body?.token === 'string' ? body.token : undefined;
    const envelopeHash = normalizeOptional(body?.envelopeHash);
    const traceId = normalizeOptional(body?.traceId);
    const intentId = normalizeOptional(body?.intentId);
    const requestId = normalizeOptional(body?.requestId);
    if (!sessionId || !Number.isFinite(seq)) {
      return NextResponse.json({ error: 'Invalid ack' }, { status: 400 });
    }
    if (REQUIRE_AGENT_TOKEN && !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (token && !verifyAgentToken(token, { sessionId, roomId })) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    recordAck(sessionId, seq, clientId || 'unknown', Number.isFinite(ts) ? ts : Date.now(), {
      envelopeHash,
      traceId,
      intentId,
      requestId,
    });
    await recordAgentTraceEvent({
      stage: 'ack_received',
      status: 'ok',
      traceId,
      requestId,
      intentId,
      room: roomId || undefined,
      task: 'canvas.agent_prompt',
      payload: {
        sessionId,
        seq,
        envelopeHash: envelopeHash ?? null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

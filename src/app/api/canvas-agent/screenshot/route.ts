import { NextRequest, NextResponse } from 'next/server';
import { storeScreenshot } from '@/server/inboxes/screenshot';
import { verifyAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';

const REQUIRE_AGENT_TOKEN = process.env.CANVAS_AGENT_REQUIRE_TOKEN === 'true';

export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > 400_000) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    const body = await req.json();
    const sessionId = String(body?.sessionId || '').trim();
    const requestId = String(body?.requestId || '').trim();
    const roomId = String(body?.roomId || '').trim();
    const token = typeof body?.token === 'string' ? body.token : undefined;
    const key = `${sessionId}::${requestId}`;
    if (!key || key === '::') {
      return NextResponse.json({ error: 'Invalid screenshot payload' }, { status: 400 });
    }
    if (REQUIRE_AGENT_TOKEN && !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (token && !verifyAgentToken(token, { sessionId, roomId, requestId })) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    storeScreenshot(body as any);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

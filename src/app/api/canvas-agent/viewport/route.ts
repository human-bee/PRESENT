import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { saveViewportSelection } from '@/lib/agents/canvas-agent/server/inboxes/viewport';
import { verifyAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';

const REQUIRE_AGENT_TOKEN = process.env.CANVAS_AGENT_REQUIRE_TOKEN === 'true';

const Payload = z.object({
  sessionId: z.string(),
  roomId: z.string(),
  viewport: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  selection: z.array(z.string()).default([]),
  ts: z.number(),
  token: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Payload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const { sessionId, roomId, token } = parsed.data;
  if (REQUIRE_AGENT_TOKEN && !token) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (token && !verifyAgentToken(token, { sessionId, roomId })) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  await saveViewportSelection(parsed.data);
  return NextResponse.json({ ok: true });
}

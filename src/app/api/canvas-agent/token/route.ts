import { NextRequest, NextResponse } from 'next/server';
import { mintAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';
import { z } from 'zod';

const QuerySchema = z.object({
  sessionId: z.string().min(1),
  roomId: z.string().min(1),
});

const CLIENT_AGENT_ENABLED = process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true';

export async function GET(req: NextRequest) {
  if (!CLIENT_AGENT_ENABLED) {
    return NextResponse.json({ ok: false, error: 'disabled' }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    sessionId: url.searchParams.get('sessionId'),
    roomId: url.searchParams.get('roomId'),
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const exp = Date.now() + 120_000; // 2 minutes
  const token = mintAgentToken({ ...parsed.data, exp });
  return NextResponse.json({ ok: true, token, exp });
}

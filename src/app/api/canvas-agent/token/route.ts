import { NextRequest, NextResponse } from 'next/server';
import { mintAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';
import { z } from 'zod';

const QuerySchema = z.object({
  sessionId: z.string().min(1),
  roomId: z.string().min(1),
});

export async function GET(req: NextRequest) {
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


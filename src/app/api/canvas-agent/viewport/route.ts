import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { saveViewportSelection } from '@/lib/agents/canvas-agent/server/inboxes/viewport';

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

  // TODO(A8): verify token + LiveKit identity + rate limiting.
  await saveViewportSelection(parsed.data);
  return NextResponse.json({ ok: true });
}


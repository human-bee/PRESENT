import { NextRequest, NextResponse } from 'next/server';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const roomId = String(body?.roomId || body?.room || '').trim();
    const message = String(body?.message || body?.userMessage || '').trim();
    const model = typeof body?.model === 'string' ? body.model : undefined;
    const viewport = body?.viewport && typeof body.viewport === 'object' ? body.viewport : undefined;
    if (!roomId || !message) return NextResponse.json({ error: 'roomId and message required' }, { status: 400 });
    await runCanvasAgent({ roomId, userMessage: message, model, initialViewport: viewport });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}







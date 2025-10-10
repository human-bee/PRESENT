import { NextRequest, NextResponse } from 'next/server';
import { broadcastCanvasAction } from '@/lib/agents/shared/supabase-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { room, tool, params } = body || {};

    if (typeof room !== 'string' || !room.trim()) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    if (typeof tool !== 'string' || !tool.trim()) {
      return NextResponse.json({ error: 'Missing tool' }, { status: 400 });
    }

    await broadcastCanvasAction({ room: room.trim(), tool: tool.trim(), params: params || {} });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error('[Steward][dispatch] error', error);
    return NextResponse.json({ error: 'Failed to dispatch canvas action' }, { status: 500 });
  }
}


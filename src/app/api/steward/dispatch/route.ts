import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { config } from 'dotenv';
import { join } from 'path';

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { room, tool, params, source, rationale } = body || {};

    if (typeof room !== 'string' || room.trim() === '') {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }
    if (typeof tool !== 'string' || tool.trim() === '') {
      return NextResponse.json({ error: 'Missing tool' }, { status: 400 });
    }

    const livekitHost = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit server credentials missing' }, { status: 500 });
    }

    const svc = new RoomServiceClient(String(livekitHost), String(apiKey), String(apiSecret));
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      roomId: room,
      type: 'tool_call' as const,
      payload: {
        tool,
        params: (params && typeof params === 'object' ? params : {}) as Record<string, unknown>,
        rationale,
      },
      timestamp: Date.now(),
      source: typeof source === 'string' && source.trim() !== '' ? source : 'steward:canvas',
    };
    const data = new TextEncoder().encode(JSON.stringify(event));
    await svc.sendData(String(room), data, DataPacket_Kind.RELIABLE, { topic: 'tool_call' });
    return NextResponse.json({ ok: true, id: event.id });
  } catch (error: any) {
    console.error('[Steward][dispatch] error', error);
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
}

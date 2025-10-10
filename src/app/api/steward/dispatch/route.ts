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
    const { room, tool, params } = body || {};

    if (typeof room !== 'string' || !room.trim()) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    if (typeof tool !== 'string' || !tool.trim()) {
      return NextResponse.json({ error: 'Missing tool' }, { status: 400 });
    }

    const livekitHost = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit server credentials missing' }, { status: 500 });
    }

    const svc = new RoomServiceClient(String(livekitHost), String(apiKey), String(apiSecret));
    const payload = params && typeof params === 'object' ? params : {};
    const event = {
      id: `steward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'tool_call',
      payload: {
        tool: tool.trim(),
        params: payload,
        context: { source: 'steward', steward: 'canvas', dispatchedAt: Date.now() },
      },
      timestamp: Date.now(),
      source: 'steward' as const,
      roomId: room.trim(),
    };

    const data = new TextEncoder().encode(JSON.stringify(event));
    await svc.sendData(room.trim(), data, DataPacket_Kind.RELIABLE, { topic: 'tool_call' });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[Steward][dispatch] error', error);
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
}

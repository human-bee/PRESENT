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
    const { room, componentId, flowchartDoc, format, version } = body || {};
    if (!room || !componentId || typeof flowchartDoc !== 'string' || !format || typeof version !== 'number') {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const livekitHost = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit server credentials missing' }, { status: 500 });
    }

    const svc = new RoomServiceClient(String(livekitHost), String(apiKey), String(apiSecret));
    const event = {
      type: 'ui_update',
      componentId,
      patch: { flowchartDoc, format, version },
      timestamp: Date.now(),
    };
    const data = new TextEncoder().encode(JSON.stringify(event));
    await svc.sendData(String(room), data, DataPacket_Kind.RELIABLE, { topic: 'ui_update' });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}



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
    const { room, componentId, patch: rawPatch, summary } = body || {};

    let patch = rawPatch;
    if (!patch && typeof body?.flowchartDoc === 'string') {
      const { flowchartDoc, format, version } = body;
      if (!format || typeof version !== 'number') {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      }
      patch = { flowchartDoc, format, version };
    }

    if (!room || !componentId || !patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const livekitHost = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit server credentials missing' }, { status: 500 });
    }

    const svc = new RoomServiceClient(String(livekitHost), String(apiKey), String(apiSecret));
    const eventTimestamp =
      typeof (patch as any)?.lastUpdated === 'number'
        ? Number((patch as any).lastUpdated)
        : Date.now();

    const event = {
      type: 'update_component',
      componentId,
      patch,
      summary: typeof summary === 'string' ? summary : undefined,
      timestamp: eventTimestamp,
    };
    const data = new TextEncoder().encode(JSON.stringify(event));
    await svc.sendData(String(room), data, DataPacket_Kind.RELIABLE, { topic: 'update_component' });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { config } from 'dotenv';
import { join } from 'path';

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}

const sanitizeParams = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawRoom = typeof body?.room === 'string' ? body.room.trim() : '';
    const rawTool = typeof body?.tool === 'string' ? body.tool.trim() : '';
    if (!rawRoom || !rawTool) {
      return NextResponse.json({ error: 'Missing room or tool' }, { status: 400 });
    }

    const params = sanitizeParams(body?.params);
    const source = typeof body?.source === 'string' ? body.source : 'canvas-steward';
    const id =
      typeof body?.id === 'string' && body.id.trim().length > 0
        ? body.id.trim()
        : `${rawTool}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const livekitHost =
      process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit server credentials missing' }, { status: 500 });
    }

    const svc = new RoomServiceClient(String(livekitHost), String(apiKey), String(apiSecret));
    const payload = {
      id,
      roomId: rawRoom,
      type: 'tool_call' as const,
      payload: {
        tool: rawTool,
        params,
        context: {
          source,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
      source,
    };

    const data = new TextEncoder().encode(JSON.stringify(payload));
    await svc.sendData(rawRoom, data, DataPacket_Kind.RELIABLE, { topic: 'tool_call' });

    return NextResponse.json({ status: 'sent', id });
  } catch (error) {
    console.error('Invalid request to steward/dispatch', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}

import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { config } from 'dotenv';
import { join } from 'path';

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}

let cachedClient: RoomServiceClient | null = null;

const resolveLivekitConfig = () => {
  const host =
    process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST || '';
  const apiKey = process.env.LIVEKIT_API_KEY || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || '';
  if (!host || !apiKey || !apiSecret) {
    throw new Error('LiveKit server credentials missing: set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET');
  }
  return { host, apiKey, apiSecret };
};

const getClient = () => {
  if (cachedClient) {
    return cachedClient;
  }
  const { host, apiKey, apiSecret } = resolveLivekitConfig();
  cachedClient = new RoomServiceClient(host, apiKey, apiSecret);
  return cachedClient;
};

export async function broadcastToolCall(
  room: string,
  payload: { tool: string; params?: Record<string, unknown>; source?: string; metadata?: Record<string, unknown> },
) {
  if (!room || typeof room !== 'string') {
    throw new Error('Room name is required to broadcast tool calls');
  }
  const normalizedRoom = room.trim();
  if (!normalizedRoom) {
    throw new Error('Room name is required to broadcast tool calls');
  }

  const id = `steward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const event = {
    id,
    roomId: normalizedRoom,
    type: 'tool_call' as const,
    payload: {
      tool: payload.tool,
      params: payload.params ?? {},
      context: {
        source: payload.source ?? 'canvas-steward',
        timestamp: now,
        ...(payload.metadata ?? {}),
      },
    },
    timestamp: now,
    source: payload.source ?? 'canvas-steward',
  };

  const client = getClient();
  const encoded = new TextEncoder().encode(JSON.stringify(event));
  await client.sendData(normalizedRoom, encoded, DataPacket_Kind.RELIABLE, { topic: 'tool_call' });
  return { ok: true, id };
}

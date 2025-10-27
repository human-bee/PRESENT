import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { ACTION_VERSION, type AgentAction, type AgentActionEnvelope, type ScreenshotRequest, type AgentChatMessage } from '../shared/types';

try {
  dotenvConfig({ path: join(process.cwd(), '.env.local') });
} catch {}

let cachedClient: RoomServiceClient | null = null;
let cachedRestUrl: string | null = null;

function resolveRest(): string {
  const raw = process.env.LIVEKIT_REST_URL || process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
  if (!raw) throw new Error('LiveKit REST URL missing');
  let url = raw.trim();
  if (url.startsWith('wss://')) url = `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) url = `http://${url.slice(5)}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  return url.replace(/\/+$/, '');
}

function getClient(): RoomServiceClient {
  if (cachedClient) return cachedClient;
  const rest = resolveRest();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('LiveKit API credentials missing');
  cachedRestUrl = rest;
  cachedClient = new RoomServiceClient(rest, apiKey, apiSecret);
  return cachedClient;
}

async function ensureRoom(room: string) {
  const client = getClient();
  const name = room.trim();
  const rooms = await client.listRooms([name]);
  if (!rooms?.some((r) => r?.name === name)) throw new Error(`LiveKit room not found: ${name}`);
  return { client, normalizedRoom: name } as const;
}

export async function sendActionsEnvelope(room: string, sessionId: string, seq: number, actions: AgentAction[], options?: { partial?: boolean }) {
  const envelope: AgentActionEnvelope = {
    v: ACTION_VERSION,
    sessionId,
    seq,
    partial: options?.partial,
    actions,
    ts: Date.now(),
  };
  const data = new TextEncoder().encode(JSON.stringify({ type: 'agent:action', envelope }));
  const { client, normalizedRoom } = await ensureRoom(room);
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent:action' });
}

export async function sendChat(room: string, sessionId: string, message: AgentChatMessage) {
  const data = new TextEncoder().encode(JSON.stringify({ type: 'agent:chat', sessionId, message }));
  const { client, normalizedRoom } = await ensureRoom(room);
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent:chat' });
}

export async function sendStatus(room: string, sessionId: string, state: 'waiting_context' | 'calling_model' | 'streaming' | 'scheduled' | 'done' | 'canceled' | 'error', detail?: unknown) {
  const data = new TextEncoder().encode(JSON.stringify({ type: 'agent:status', sessionId, state, detail }));
  const { client, normalizedRoom } = await ensureRoom(room);
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent:status' });
}

export async function requestScreenshot(room: string, request: Omit<ScreenshotRequest, 'type'>): Promise<void> {
  const data = new TextEncoder().encode(JSON.stringify({ ...request, type: 'agent:screenshot_request' }));
  const { client, normalizedRoom } = await ensureRoom(room);
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent:screenshot_request' });
}

export async function awaitAck(_room: string, _sessionId: string, _seq: number, _timeoutMs: number) {
  // Runner should implement ack tracking; this is a placeholder for parity with the plan.
  return true;
}




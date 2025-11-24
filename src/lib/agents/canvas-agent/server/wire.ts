import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import {
  ACTION_VERSION,
  type AgentAction,
  type AgentActionEnvelope,
  type ScreenshotRequest,
  type AgentChatMessage,
} from '@/lib/canvas-agent/contract/types';
import { mintAgentToken } from './auth/agentTokens';

type AckRecord = {
  seq: number;
  clientId: string;
  ts: number;
};

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
  const maxEdge = clampEdge(Number(process.env.CANVAS_AGENT_SCREENSHOT_MAX_SIZE ?? 1024));
  const token = mintAgentToken({
    sessionId: request.sessionId,
    roomId: room,
    requestId: request.requestId,
    exp: Date.now() + 60_000,
  });
  const payload: ScreenshotRequest = {
    type: 'agent:screenshot_request',
    sessionId: request.sessionId,
    requestId: request.requestId,
    bounds: sanitizeBounds(request.bounds),
    maxSize: request.maxSize
      ? { w: clampEdge(request.maxSize.w), h: clampEdge(request.maxSize.h) }
      : { w: maxEdge, h: maxEdge },
    token,
    roomId: room,
  };
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const { client, normalizedRoom } = await ensureRoom(room);
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent:screenshot_request' });
}

const ACK_BACKOFF_MS = [150, 300, 600, 1000];
let ackModulePromise: Promise<any> | null = null;

async function loadAckModule() {
  if (!ackModulePromise) {
    ackModulePromise = import('@/server/inboxes/ack');
  }
  return ackModulePromise;
}

export async function awaitAck(opts: { sessionId: string; seq: number; deadlineMs?: number }) {
  const ackModule = await loadAckModule();
  const getAck =
    typeof ackModule?.getAck === 'function'
      ? ackModule.getAck
      : typeof ackModule?.default?.getAck === 'function'
        ? ackModule.default.getAck
        : null;
  if (!getAck) {
    throw new Error('Ack inbox missing getAck implementation; ensure server inbox is up to date.');
  }
  const start = Date.now();
  const deadline = start + (opts.deadlineMs ?? 1500);
  let attempt = 0;
  while (Date.now() < deadline) {
    const ack = getAck(opts.sessionId, opts.seq);
    if (ack) return ack;
    const wait = ACK_BACKOFF_MS[Math.min(attempt, ACK_BACKOFF_MS.length - 1)];
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return null;
}

function clampEdge(edge: number): number {
  if (!Number.isFinite(edge) || edge <= 0) return 1024;
  return Math.max(64, Math.min(4096, Math.floor(edge)));
}

function sanitizeBounds(bounds?: { x: number; y: number; w: number; h: number }) {
  if (!bounds) return undefined;
  return {
    x: Number.isFinite(bounds.x) ? Math.floor(bounds.x) : 0,
    y: Number.isFinite(bounds.y) ? Math.floor(bounds.y) : 0,
    w: Number.isFinite(bounds.w) ? Math.max(32, Math.floor(bounds.w)) : 512,
    h: Number.isFinite(bounds.h) ? Math.max(32, Math.floor(bounds.h)) : 512,
  };
}

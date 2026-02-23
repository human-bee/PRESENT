import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { createHash } from 'crypto';
import {
  ACTION_VERSION,
  type AgentAction,
  type AgentActionEnvelope,
  type AgentTraceEvent,
  type ScreenshotRequest,
  type AgentChatMessage,
} from '@/lib/canvas-agent/contract/types';
import { mintAgentToken } from './auth/agentTokens';

try {
  dotenvConfig({ path: join(process.cwd(), '.env.local') });
} catch {}

let cachedClient: RoomServiceClient | null = null;
let _cachedRestUrl: string | null = null;
const LIVEKIT_ROOM_WAIT_TIMEOUT_MS = Math.max(
  250,
  Number.parseInt(process.env.LIVEKIT_ROOM_WAIT_TIMEOUT_MS ?? '5000', 10) || 5000,
);
const LIVEKIT_ROOM_WAIT_INTERVAL_MS = Math.max(
  50,
  Number.parseInt(process.env.LIVEKIT_ROOM_WAIT_INTERVAL_MS ?? '250', 10) || 250,
);
const LIVEKIT_SEND_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.LIVEKIT_SEND_RETRY_ATTEMPTS ?? '3', 10) || 3,
);
const LIVEKIT_SEND_RETRY_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.LIVEKIT_SEND_RETRY_DELAY_MS ?? '200', 10) || 200,
);

function resolveRest(): string {
  const raw =
    process.env.LIVEKIT_REST_URL ||
    process.env.LIVEKIT_URL ||
    process.env.NEXT_PUBLIC_LK_SERVER_URL ||
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    process.env.LIVEKIT_HOST;
  if (!raw) throw new Error('LiveKit REST URL missing');
  let url = raw.trim();
  if (url.startsWith('wss://')) url = `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) url = `http://${url.slice(5)}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  return url.replace(/\/+$/, '');
}

function getClient(): RoomServiceClient {
  const rest = resolveRest();
  if (cachedClient && _cachedRestUrl === rest) return cachedClient;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('LiveKit API credentials missing');
  _cachedRestUrl = rest;
  cachedClient = new RoomServiceClient(rest, apiKey, apiSecret);
  return cachedClient;
}

async function ensureRoom(room: string) {
  const client = getClient();
  const name = room.trim();
  if (!name) throw new Error('LiveKit room name missing');

  const deadline = Date.now() + LIVEKIT_ROOM_WAIT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const rooms = await client.listRooms([name]);
      if (rooms?.some((r) => r?.name === name)) {
        return { client, normalizedRoom: name, roomReady: true, waitError: null } as const;
      }
    } catch (error) {
      lastError = error;
    }
    if (LIVEKIT_ROOM_WAIT_INTERVAL_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, LIVEKIT_ROOM_WAIT_INTERVAL_MS));
    }
  }

  try {
    await client.createRoom({
      name,
      emptyTimeout: 60,
      departureTimeout: 30,
    });
    return { client, normalizedRoom: name, roomReady: true, waitError: null } as const;
  } catch (error) {
    const typed = error as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
    const numericCode =
      typeof typed?.code === 'number'
        ? typed.code
        : typeof typed?.statusCode === 'number'
          ? typed.statusCode
          : typeof typed?.status === 'number'
            ? typed.status
            : null;
    const stringCode = typeof typed?.code === 'string' ? typed.code.trim().toLowerCase() : '';
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
    if (
      numericCode === 6 ||
      numericCode === 409 ||
      stringCode === 'already_exists' ||
      stringCode === 'alreadyexists' ||
      message.includes('already exists') ||
      message.includes('room already exists') ||
      message.includes('alreadyexists') ||
      message.includes('code = alreadyexists')
    ) {
      return { client, normalizedRoom: name, roomReady: true, waitError: null } as const;
    }
    lastError = error ?? lastError;
  }

  const waitError =
    lastError instanceof Error
      ? `${lastError.message}${_cachedRestUrl ? ` (rest=${_cachedRestUrl})` : ''}`
      : `LiveKit room not found before timeout: ${name}`;
  return { client, normalizedRoom: name, roomReady: false, waitError } as const;
}

async function sendRoomData(params: {
  room: string;
  topic: string;
  data: Uint8Array;
}) {
  const { room, topic, data } = params;
  let resolution = await ensureRoom(room);
  let lastError: unknown =
    resolution.roomReady
      ? null
      : new Error(
          resolution.waitError && resolution.waitError.trim().length > 0
            ? `LiveKit room readiness failed for ${resolution.normalizedRoom}: ${resolution.waitError}`
            : `LiveKit room not found before timeout: ${resolution.normalizedRoom}`,
        );

  for (let attempt = 0; attempt < LIVEKIT_SEND_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await resolution.client.sendData(
        resolution.normalizedRoom,
        data,
        DataPacket_Kind.RELIABLE,
        { topic },
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= LIVEKIT_SEND_RETRY_ATTEMPTS) break;
      if (LIVEKIT_SEND_RETRY_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, LIVEKIT_SEND_RETRY_DELAY_MS));
      }
      resolution = await ensureRoom(room);
    }
  }

  throw new Error(
    `LiveKit sendData failed for ${resolution.normalizedRoom}: ${
      lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown')
    }`,
  );
}

const hashActionsEnvelope = (input: {
  sessionId: string;
  seq: number;
  partial?: boolean;
  actions: AgentAction[];
  traceId?: string;
  intentId?: string;
  requestId?: string;
}) => {
  const basis = JSON.stringify({
    sessionId: input.sessionId,
    seq: input.seq,
    partial: input.partial ?? false,
    actions: input.actions,
    traceId: input.traceId,
    intentId: input.intentId,
    requestId: input.requestId,
  });
  return createHash('sha1').update(basis).digest('hex').slice(0, 20);
};

export async function sendActionsEnvelope(
  room: string,
  sessionId: string,
  seq: number,
  actions: AgentAction[],
  options?: {
    partial?: boolean;
    correlation?: { traceId?: string; intentId?: string; requestId?: string };
  },
) {
  const hash = hashActionsEnvelope({
    sessionId,
    seq,
    partial: options?.partial,
    actions,
    traceId: options?.correlation?.traceId,
    intentId: options?.correlation?.intentId,
    requestId: options?.correlation?.requestId,
  });
  const envelope: AgentActionEnvelope = {
    v: ACTION_VERSION,
    sessionId,
    seq,
    hash,
    ...(options?.correlation?.traceId ? { traceId: options.correlation.traceId } : {}),
    ...(options?.correlation?.intentId ? { intentId: options.correlation.intentId } : {}),
    ...(options?.correlation?.requestId ? { requestId: options.correlation.requestId } : {}),
    partial: options?.partial,
    actions,
    ts: Date.now(),
  };
  const data = new TextEncoder().encode(JSON.stringify({ type: 'agent:action', envelope }));
  await sendRoomData({
    room,
    topic: 'agent:action',
    data,
  });
  return { hash };
}

export async function sendChat(room: string, sessionId: string, message: AgentChatMessage) {
  const data = new TextEncoder().encode(JSON.stringify({ type: 'agent:chat', sessionId, message }));
  await sendRoomData({
    room,
    topic: 'agent:chat',
    data,
  });
}

export async function sendStatus(room: string, sessionId: string, state: 'waiting_context' | 'calling_model' | 'streaming' | 'scheduled' | 'done' | 'canceled' | 'error', detail?: unknown) {
  const data = new TextEncoder().encode(JSON.stringify({ type: 'agent:status', sessionId, state, detail }));
  await sendRoomData({
    room,
    topic: 'agent:status',
    data,
  });
}

export async function sendTrace(
  room: string,
  payload: Omit<AgentTraceEvent, 'type' | 'at'> & { at?: number },
) {
  const normalizedRoom = room.trim();
  if (!normalizedRoom) return;
  const tracePayload: AgentTraceEvent = {
    ...payload,
    type: 'agent:trace',
    at: payload.at ?? Date.now(),
  };
  const data = new TextEncoder().encode(JSON.stringify(tracePayload));
  const client = getClient();
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent:trace' });
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
    ...(typeof request.requesterParticipantId === 'string' && request.requesterParticipantId.trim().length > 0
      ? { requesterParticipantId: request.requesterParticipantId.trim() }
      : {}),
  };
  const data = new TextEncoder().encode(JSON.stringify(payload));
  await sendRoomData({
    room,
    topic: 'agent:screenshot_request',
    data,
  });
}

// Keep ack polling snappy; this path is latency-sensitive and tests run in a noisy event loop.
const ACK_BACKOFF_MS = [25, 50, 100, 200, 300, 500, 1000];
let ackModulePromise: Promise<any> | null = null;

async function loadAckModule() {
  if (!ackModulePromise) {
    ackModulePromise = import('@/server/inboxes/ack');
  }
  return ackModulePromise;
}

export async function awaitAck(opts: {
  sessionId: string;
  seq: number;
  deadlineMs?: number;
  expectedHash?: string;
}) {
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
    if (ack) {
      if (
        opts.expectedHash &&
        typeof (ack as any).envelopeHash === 'string' &&
        (ack as any).envelopeHash !== opts.expectedHash
      ) {
        const wait = ACK_BACKOFF_MS[Math.min(attempt, ACK_BACKOFF_MS.length - 1)];
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      return ack;
    }
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

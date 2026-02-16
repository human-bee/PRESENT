import { Room, RoomEvent, ParticipantKind } from 'livekit-client';
import { createLogger } from '@/lib/logging';

type ChunkEnvelope = {
  __chunked: true;
  id: string;
  index: number;
  total: number;
  chunk: string;
  encoding: 'base64';
};

export type LiveKitBusSendResult = {
  status: 'sent' | 'queued' | 'failed';
  reason?: string;
  queueLength?: number;
};

const MAX_DATA_CHANNEL_BYTES = 60_000; // LiveKit hard limit is 65_535 bytes
const MAX_CHUNK_STRING_LENGTH = 40_000; // leave headroom for JSON metadata
const CHUNK_TTL_MS = 60_000;

function encodeUtf8(input: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input);
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(input, 'utf-8'));
  }
  const arr = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    arr[i] = input.charCodeAt(i);
  }
  return arr;
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf-8');
  }
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  // Fallback: return binary string (will reassemble the same way)
  return binary;
}

function decodeBase64ToUtf8(base64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return decodeUtf8(bytes);
  }
  return base64;
}

/**
 * Lightweight event bus on top of LiveKit data-channels. Each message is JSON
 * encoded and routed by `topic` (string).
 *
 * Usage:
 *   const bus = createLiveKitBus(room);
 *   bus.send('transcription', { text: 'hello' });
 *   bus.on('transcription', (msg) => { ... });
 */
type BusInstance = ReturnType<typeof createLiveKitBusInstance>;
const busCacheByRoom = new WeakMap<Room, BusInstance>();
type BusCacheEntry = { bus: BusInstance; room: Room };
const busCacheBySid = new Map<string, BusCacheEntry>();
const stubBus: BusInstance = {
  send() {},
  async sendWithResult() {
    return { status: 'failed', reason: 'room_unavailable' as const };
  },
  on() {
    return () => {};
  },
};
type ListenerEntry = { room: Room; onState: () => void; onParticipant: () => void };
const listenerRegistryBySid = new Map<string, ListenerEntry>();
const listenerRegistryByRoom = new WeakMap<Room, ListenerEntry>();

const registerSidEntry = (sid: string, entry: ListenerEntry) => {
  const existing = listenerRegistryBySid.get(sid);
  if (existing && existing.room !== entry.room) {
    existing.room.off(RoomEvent.ConnectionStateChanged, existing.onState);
    existing.room.off(RoomEvent.ParticipantConnected, existing.onParticipant);
    listenerRegistryByRoom.delete(existing.room);
  }
  listenerRegistryBySid.set(sid, entry);
  const cached = busCacheByRoom.get(entry.room);
  if (cached) {
    busCacheBySid.set(sid, { bus: cached, room: entry.room });
  }
};

const getRoomSid = (room: Room | null | undefined): string | null => {
  const sid = (room as unknown as { sid?: unknown } | null)?.sid;
  return typeof sid === 'string' && sid.trim().length > 0 ? sid : null;
};

function createLiveKitBusInstance(room: Room | null | undefined) {
  const logger = createLogger('LiveKitBus');
  const shouldLogBusInit = () => process.env.NODE_ENV !== 'production' && Boolean(getRoomSid(room));
  if (shouldLogBusInit()) {
    try {
      const label = `${room?.name ?? 'unknown'}#${getRoomSid(room) ?? 'no-sid'}`;
      logger.debug('createLiveKitBus', { label, state: room?.state });
      logger.debug('instantiated', { label, state: room?.state });
    } catch {}
  }
  let lastWarnedDisconnectedAt = 0;
  const DISCONNECT_WARN_THROTTLE_MS = 5000;
  const PENDING_QUEUE_TTL_MS = 60_000;
  const MAX_PENDING_QUEUE = 64;
  const pendingQueue: Array<{
    topic: string;
    payload: unknown;
    queuedAt: number;
    requiresAgent?: boolean;
  }> = [];
  let listenersAttached = false;
  let flushInFlight = false;
  const handleStateChange = () => {
    void flushPending();
  };

  let flushRetryHandle: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlushRetry = () => {
    if (!room || room.state !== 'connected') return;
    if (flushRetryHandle) return;
    flushRetryHandle = setTimeout(() => {
      flushRetryHandle = null;
      void flushPending();
    }, 250);
  };

  const isVoiceAgentPresent = () => {
    if (!room) return false;
    try {
      const participants = Array.from(room.remoteParticipants.values());
      return participants.some((participant) => {
        if (participant?.kind === ParticipantKind.AGENT) return true;
        const identity = String(participant?.identity || '').toLowerCase();
        const metadata = String(participant?.metadata || '').toLowerCase();
        return (
          identity.includes('voice-agent') ||
          identity === 'voiceagent' ||
          metadata.includes('voice-agent') ||
          metadata.includes('voiceagent')
        );
      });
    } catch {
      return false;
    }
  };

  const shouldWaitForAgent = (topic: string, payload: unknown): boolean => {
    if (topic !== 'transcription') return false;
    if (!payload || typeof payload !== 'object') return false;
    const record = payload as Record<string, unknown>;
    return Boolean(record.manual);
  };

  const prunePendingQueue = () => {
    const now = Date.now();
    for (let i = pendingQueue.length - 1; i >= 0; i -= 1) {
      if (now - pendingQueue[i].queuedAt > PENDING_QUEUE_TTL_MS) {
        pendingQueue.splice(i, 1);
      }
    }
    if (pendingQueue.length > MAX_PENDING_QUEUE) {
      pendingQueue.splice(0, pendingQueue.length - MAX_PENDING_QUEUE);
    }
  };

  const publishPayload = async (topic: string, payload: unknown): Promise<boolean> => {
    if (!room) return false;

    const json = JSON.stringify(payload);
    const bytes = encodeUtf8(json);

    if (bytes.length <= MAX_DATA_CHANNEL_BYTES) {
      try {
        const result = room.localParticipant?.publishData(bytes, {
          reliable: true,
          topic,
        });
        if (!result) {
          logger.warn('Failed to send: local participant unavailable', { topic });
          return false;
        }
        await Promise.resolve(result);
        return true;
      } catch (err) {
        logger.error('Failed to send', topic, err);
        return false;
      }
    }

    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const base64 = encodeBase64(bytes);
    const totalChunks = Math.ceil(base64.length / MAX_CHUNK_STRING_LENGTH);

    logger.warn('Payload exceeds LiveKit data channel limit, chunking message.', {
      topic,
      messageId,
      totalChunks,
      size: bytes.length,
    });

    for (let index = 0; index < totalChunks; index++) {
      const start = index * MAX_CHUNK_STRING_LENGTH;
      const end = start + MAX_CHUNK_STRING_LENGTH;
      const chunkPayload: ChunkEnvelope = {
        __chunked: true,
        id: messageId,
        index,
        total: totalChunks,
        chunk: base64.slice(start, end),
        encoding: 'base64',
      };

      try {
        const result = room.localParticipant?.publishData(encodeUtf8(JSON.stringify(chunkPayload)), {
          reliable: true,
          topic,
        });
        if (!result) {
          logger.warn('Failed to send chunk: local participant unavailable', {
            topic,
            messageId,
            index,
          });
          return false;
        }
        await Promise.resolve(result);
      } catch (err) {
        logger.error('Failed to send chunk', { topic, messageId, index }, err);
        return false;
      }
    }
    return true;
  };

  const flushPending = async () => {
    if (!room || room.state !== 'connected') return;
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      prunePendingQueue();
      if (pendingQueue.length === 0) return;

      const agentReady = isVoiceAgentPresent();
      const retained: typeof pendingQueue = [];

      while (pendingQueue.length > 0) {
        const next = pendingQueue.shift();
        if (!next) continue;
        if (next.requiresAgent && !agentReady) {
          retained.push(next);
          continue;
        }

        const sent = await publishPayload(next.topic, next.payload);
        if (!sent) {
          retained.unshift(next);
          retained.push(...pendingQueue.splice(0));
          break;
        }
      }

      pendingQueue.push(...retained);

      if (pendingQueue.length > 0) {
        const shouldRetrySoon =
          agentReady || pendingQueue.some((entry) => !entry.requiresAgent);
        if (shouldRetrySoon) {
          scheduleFlushRetry();
        }
      }
    } finally {
      flushInFlight = false;
    }
  };

  const ensureListeners = () => {
    if (!room || listenersAttached) return;

    const existing = listenerRegistryByRoom.get(room);
    if (existing) {
      listenersAttached = true;
      const roomSid = getRoomSid(room);
      if (roomSid) {
        registerSidEntry(roomSid, existing);
      }
      return;
    }

    const entry: ListenerEntry = {
      room,
      onState: handleStateChange,
      onParticipant: handleStateChange,
    };

    room.on(RoomEvent.ConnectionStateChanged, entry.onState);
    room.on(RoomEvent.ParticipantConnected, entry.onParticipant);
    listenerRegistryByRoom.set(room, entry);
    listenersAttached = true;

    const attachWhenSidReady = () => {
      const roomSid = getRoomSid(room);
      if (!roomSid) return;
      room.off(RoomEvent.ConnectionStateChanged, attachWhenSidReady);
      registerSidEntry(roomSid, entry);
    };

    const roomSid = getRoomSid(room);
    if (roomSid) {
      registerSidEntry(roomSid, entry);
    } else {
      room.on(RoomEvent.ConnectionStateChanged, attachWhenSidReady);
    }

    void flushPending();
  };
  ensureListeners();

  const sendWithResult = async (topic: string, payload: unknown): Promise<LiveKitBusSendResult> => {
    if (!room) {
      return { status: 'failed', reason: 'room_unavailable' };
    }

    ensureListeners();

    const requiresAgent = shouldWaitForAgent(topic, payload);

    if (room.state !== 'connected') {
      pendingQueue.push({ topic, payload, queuedAt: Date.now(), requiresAgent });
      prunePendingQueue();
      const now = Date.now();
      if (now - lastWarnedDisconnectedAt > DISCONNECT_WARN_THROTTLE_MS) {
        lastWarnedDisconnectedAt = now;
        logger.info('Queueing payload until room is connected', {
          topic,
          queueLength: pendingQueue.length,
          currentState: room.state,
        });
      }
      return {
        status: 'queued',
        reason: 'room_not_connected',
        queueLength: pendingQueue.length,
      };
    }

    if (requiresAgent && !isVoiceAgentPresent()) {
      pendingQueue.push({ topic, payload, queuedAt: Date.now(), requiresAgent: true });
      prunePendingQueue();
      logger.debug?.('Queueing transcription until voice agent joins', {
        topic,
        queueLength: pendingQueue.length,
      });
      return {
        status: 'queued',
        reason: 'agent_not_joined',
        queueLength: pendingQueue.length,
      };
    }

    const sent = await publishPayload(topic, payload);
    if (!sent) {
      pendingQueue.unshift({ topic, payload, queuedAt: Date.now(), requiresAgent });
      prunePendingQueue();
      scheduleFlushRetry();
      return {
        status: 'queued',
        reason: 'publish_retry_queued',
        queueLength: pendingQueue.length,
      };
    }
    return { status: 'sent' };
  };

  return {
    /** Publish a JSON-serialisable payload under the given topic */
    send(topic: string, payload: unknown) {
      void sendWithResult(topic, payload).catch((error) => {
        logger.error('Failed to queue/publish bus payload', { topic }, error);
      });
    },

    async sendWithResult(topic: string, payload: unknown) {
      return sendWithResult(topic, payload);
    },

    /**
     * Subscribe to a topic. Returns an unsubscribe function. Must be called
     * inside a React effect when used with `useDataChannel`.
     */
    on(topic: string, handler: (payload: unknown) => void) {
      if (!room) return () => {};

      type ChunkBuffer = {
        parts: string[];
        received: number;
        createdAt: number;
        encoding: 'base64';
      };
      const chunkBuffers = new Map<string, ChunkBuffer>();

      const cleanupExpiredChunks = () => {
        const now = Date.now();
        for (const [id, buffer] of chunkBuffers) {
          if (now - buffer.createdAt > CHUNK_TTL_MS) {
            chunkBuffers.delete(id);
            logger.warn('Discarded stale chunk buffer', { topic, id });
          }
        }
      };

      // Create the actual listener that will be registered
      const dataReceivedHandler = (
        data: Uint8Array,
        _participant: unknown,
        _kind: unknown,
        topicName: unknown,
      ) => {
        if (topicName === topic) {
          try {
            const decoded = decodeUtf8(data);
            const msg = JSON.parse(decoded) as ChunkEnvelope | Record<string, unknown>;

            if (msg && (msg as ChunkEnvelope).__chunked) {
              const chunk = msg as ChunkEnvelope;
              if (
                typeof chunk.id !== 'string' ||
                typeof chunk.index !== 'number' ||
                typeof chunk.total !== 'number' ||
                typeof chunk.chunk !== 'string'
              ) {
                logger.warn('Received malformed chunked payload', { topic, chunk });
                return;
              }

              cleanupExpiredChunks();
              let buffer = chunkBuffers.get(chunk.id);
              if (!buffer) {
                buffer = {
                  parts: new Array(chunk.total).fill(''),
                  received: 0,
                  createdAt: Date.now(),
                  encoding: chunk.encoding ?? 'base64',
                };
                chunkBuffers.set(chunk.id, buffer);
              }

              if (!buffer.parts[chunk.index]) {
                buffer.parts[chunk.index] = chunk.chunk;
                buffer.received += 1;
              }

              if (buffer.received >= buffer.parts.length) {
                chunkBuffers.delete(chunk.id);
                const combined = buffer.parts.join('');
                try {
                  const jsonString =
                    buffer.encoding === 'base64' ? decodeBase64ToUtf8(combined) : combined;
                  const fullPayload = JSON.parse(jsonString);
                  handler(fullPayload);
                } catch (err) {
                  logger.error('Failed to reassemble chunked payload', err);
                }
              }
              return;
            }

            handler(msg);
          } catch (err) {
            logger.warn('Failed to decode data message', err);
          }
        }
      };

      // Register the handler
      room.on('dataReceived', dataReceivedHandler);

      // Return cleanup function that removes the exact same handler
      return () => {
        room.off('dataReceived', dataReceivedHandler);
      };
    },
  } as const;
}

export function createLiveKitBus(room: Room | null | undefined) {
  if (!room) {
    return stubBus;
  }

  const cachedByRoom = busCacheByRoom.get(room);
  if (cachedByRoom) {
    return cachedByRoom;
  }

  const roomSid = getRoomSid(room);
  if (roomSid) {
    const cachedEntry = busCacheBySid.get(roomSid);
    if (cachedEntry) {
      if (cachedEntry.room === room) {
        busCacheByRoom.set(room, cachedEntry.bus);
        return cachedEntry.bus;
      }

      const newBus = createLiveKitBusInstance(room);
      busCacheByRoom.set(room, newBus);
      busCacheBySid.set(roomSid, { bus: newBus, room });
      return newBus;
    }
  }

  const bus = createLiveKitBusInstance(room);
  busCacheByRoom.set(room, bus);
  if (roomSid) {
    busCacheBySid.set(roomSid, { bus, room });
  }
  return bus;
}

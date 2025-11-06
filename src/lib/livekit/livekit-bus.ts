export type { DataMessage } from '@livekit/components-react';

import { Room, RoomEvent } from 'livekit-client';
import { createLogger } from '@/lib/utils';

type ChunkEnvelope = {
  __chunked: true;
  id: string;
  index: number;
  total: number;
  chunk: string;
  encoding: 'base64';
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
  on() {
    return () => {};
  },
};
type ListenerEntry = { room: Room; onState: () => void; onParticipant: () => void };
const listenerRegistryBySid = new Map<string, ListenerEntry>();

function createLiveKitBusInstance(room: Room | null | undefined) {
  const logger = createLogger('LiveKitBus');
  const shouldLogBusInit = () => process.env.NODE_ENV !== 'production' && room && room.sid;
  if (shouldLogBusInit()) {
    try {
      const label = `${room!.name ?? 'unknown'}#${room!.sid}`;
      console.debug('[LiveKitBus][debug] createLiveKitBus', { label, state: room?.state });
      console.debug('[LiveKitBus][debug] instantiated', { label, state: room?.state });
    } catch {}
  }
  let lastWarnedDisconnectedAt = 0;
  const DISCONNECT_WARN_THROTTLE_MS = 5000;
  const pendingQueue: Array<{ topic: string; payload: unknown; queuedAt: number }> = [];
  let listenersAttached = false;
  const handleStateChange = () => flushPending();

  let flushRetryHandle: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlushRetry = () => {
    if (!room || room.state !== 'connected') return;
    if (flushRetryHandle) return;
    flushRetryHandle = setTimeout(() => {
      flushRetryHandle = null;
      flushPending();
    }, 250);
  };

  const publishPayload = (topic: string, payload: unknown): boolean => {
    if (!room) return false;

    const json = JSON.stringify(payload);
    const bytes = encodeUtf8(json);

    if (bytes.length <= MAX_DATA_CHANNEL_BYTES) {
      try {
        const result = room.localParticipant?.publishData(bytes, {
          reliable: true,
          topic,
        });
        handlePublishResult(result, topic);
        return true;
      } catch (err) {
        logger.error('Failed to send', topic, err);
        pendingQueue.unshift({ topic, payload, queuedAt: Date.now() });
        scheduleFlushRetry();
        return false;
      }
      return true;
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
        handlePublishResult(result, topic, { messageId, index });
      } catch (err) {
        logger.error('Failed to send chunk', { topic, messageId, index }, err);
        pendingQueue.unshift({ topic, payload, queuedAt: Date.now() });
        scheduleFlushRetry();
        return false;
      }
    }
    return true;
  };

  const flushPending = () => {
    if (!room || room.state !== 'connected') return;
    while (pendingQueue.length > 0) {
      const next = pendingQueue.shift();
      if (!next) break;
      const sent = publishPayload(next.topic, next.payload);
      if (!sent) {
        // Leave remaining entries for a future flush once the room recovers.
        scheduleFlushRetry();
        break;
      }
    }
  };

  const ensureListeners = () => {
    if (!room || listenersAttached) return;
    const sid = room.sid;
    if (!sid) return; // wait until room announces its sid

    const existing = listenerRegistryBySid.get(sid);
    if (existing) {
      if (existing.room !== room) {
        existing.room.off(RoomEvent.ConnectionStateChanged, existing.onState);
        existing.room.off(RoomEvent.ParticipantConnected, existing.onParticipant);
        listenerRegistryBySid.delete(sid);
      } else {
        listenersAttached = true;
        return;
      }
    }

    const entry: ListenerEntry = {
      room,
      onState: handleStateChange,
      onParticipant: handleStateChange,
    };

    room.on(RoomEvent.ConnectionStateChanged, entry.onState);
    room.on(RoomEvent.ParticipantConnected, entry.onParticipant);
    listenerRegistryBySid.set(sid, entry);
    const cached = busCacheByRoom.get(room);
    if (cached) {
      busCacheBySid.set(sid, { bus: cached, room });
    }
    listenersAttached = true;
    flushPending();
  };
  ensureListeners();

  const handlePublishResult = (result: unknown, topic: string, context?: Record<string, unknown>) => {
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      (result as PromiseLike<unknown>).catch((err) => {
        logger.error('Failed to send', { topic, ...context }, err);
      });
    }
  };

  return {
    /** Publish a JSON-serialisable payload under the given topic */
    send(topic: string, payload: unknown) {
      // Guard against stale or disconnected rooms. Calling publishData when
      // the underlying PeerConnection is already closed will throw
      // `UnexpectedConnectionState: PC manager is closed` inside livekit-client.
      // See https://github.com/livekit/components-js/issues/XXX (example) for details.

      // 1. Room reference must exist.
      if (!room) return;

      ensureListeners();

      if (room.state !== 'connected') {
        pendingQueue.push({ topic, payload, queuedAt: Date.now() });
        const now = Date.now();
        if (now - lastWarnedDisconnectedAt > DISCONNECT_WARN_THROTTLE_MS) {
          lastWarnedDisconnectedAt = now;
          logger.info('Queueing payload until room is connected', {
            topic,
            queueLength: pendingQueue.length,
            currentState: room.state,
          });
        }
        return;
      }

      publishPayload(topic, payload);
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
      const dataReceivedHandler = (data: Uint8Array, _p: any, _k: any, t: any) => {
        if (t === topic) {
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

  if (room.sid) {
    const cachedEntry = busCacheBySid.get(room.sid);
    if (cachedEntry) {
      if (cachedEntry.room === room) {
        busCacheByRoom.set(room, cachedEntry.bus);
        return cachedEntry.bus;
      }

      const newBus = createLiveKitBusInstance(room);
      busCacheByRoom.set(room, newBus);
      busCacheBySid.set(room.sid, { bus: newBus, room });
      return newBus;
    }
  }

  const bus = createLiveKitBusInstance(room);
  busCacheByRoom.set(room, bus);
  if (room.sid) {
    busCacheBySid.set(room.sid, { bus, room });
  }
  return bus;
}

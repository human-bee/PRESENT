export type { DataMessage } from '@livekit/components-react';

import { Room } from 'livekit-client';
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
export function createLiveKitBus(room: Room | null | undefined) {
  const logger = createLogger('LiveKitBus');
  let lastWarnedDisconnectedAt = 0;
  const DISCONNECT_WARN_THROTTLE_MS = 5000;
  return {
    /** Publish a JSON-serialisable payload under the given topic */
    send(topic: string, payload: unknown) {
      // Guard against stale or disconnected rooms. Calling publishData when
      // the underlying PeerConnection is already closed will throw
      // `UnexpectedConnectionState: PC manager is closed` inside livekit-client.
      // See https://github.com/livekit/components-js/issues/XXX (example) for details.

      // 1. Room reference must exist.
      if (!room) return;

      // 2. Only attempt to publish when the room is fully connected. The room
      //    state is managed internally by livekit-client and will be one of
      //    'connected' | 'connecting' | 'reconnecting' | 'disconnected'. We
      //    publish ONLY when connected to avoid race-conditions during
      //    teardown.
      //    Ref: https://docs.livekit.io/client-sdk-js/interfaces/Room.html#state
      if (room.state !== 'connected') {
        const now = Date.now();
        if (now - lastWarnedDisconnectedAt > DISCONNECT_WARN_THROTTLE_MS) {
          lastWarnedDisconnectedAt = now;
          logger.info('Skipping publishData – room not connected.', {
            topic,
            currentState: room.state,
          });
        } else {
          logger.debug('Skipping publishData (throttled) – room not connected.', topic);
        }
        return;
      }

      const json = JSON.stringify(payload);
      const bytes = encodeUtf8(json);

      if (bytes.length <= MAX_DATA_CHANNEL_BYTES) {
        try {
          room.localParticipant?.publishData(bytes, {
            reliable: true,
            topic,
          });
        } catch (err) {
          logger.error('Failed to send', topic, err);
        }
        return;
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
          room.localParticipant?.publishData(encodeUtf8(JSON.stringify(chunkPayload)), {
            reliable: true,
            topic,
          });
        } catch (err) {
          logger.error('Failed to send chunk', { topic, messageId, index }, err);
          break;
        }
      }
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

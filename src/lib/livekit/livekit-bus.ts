export type { DataMessage } from '@livekit/components-react';

import { Room } from 'livekit-client';

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
        console.warn('[LiveKitBus] Skipping publishData – room not connected.', {
          topic,
          currentState: room.state,
        });
        return;
      }

      try {
        room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          reliable: true,
          topic,
        });
      } catch (err) {
        console.error('[LiveKitBus] Failed to send', topic, err);
      }
    },

    /**
     * Subscribe to a topic. Returns an unsubscribe function. Must be called
     * inside a React effect when used with `useDataChannel`.
     */
    on(topic: string, handler: (payload: unknown) => void) {
      if (!room) return () => {};

      // Create the actual listener that will be registered
      const dataReceivedHandler = (data: Uint8Array, _p: any, _k: any, t: any) => {
        if (t === topic) {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data));
            handler(msg);
          } catch (err) {
            console.error('[LiveKitBus] Failed to decode', err);
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

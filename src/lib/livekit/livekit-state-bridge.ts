import { Room, RoomEvent } from 'livekit-client';
import { systemRegistry } from '../system-registry';
import { StateEnvelope } from '../shared-state';

type StopLiveKitStateBridge = () => void;

/**
 * Bridges SystemRegistry state events to LiveKit data channel messages and back.
 */
export class LiveKitStateBridge {
  private room: Room;
  private topic = 'state_change';
  private stop: StopLiveKitStateBridge | null = null;

  constructor(room: Room) {
    this.room = room;
  }

  start() {
    if (this.stop) return this.stop;

    // listen for messages from others
    const onDataReceived = (payload: Uint8Array, participant?: { isLocal?: boolean }, _kind?: unknown, topic?: string) => {
      if (topic !== this.topic) return;
      try {
        const decoded = JSON.parse(new TextDecoder().decode(payload)) as StateEnvelope;
        if (!decoded || !decoded.kind) return;
        // Avoid echo loop – ignore messages we originated
        if (decoded.origin === 'browser' && participant?.isLocal) return;
        systemRegistry.ingestState(decoded);
      } catch (_) {
        /* ignore non JSON */
      }
    };
    this.room.on(RoomEvent.DataReceived, onDataReceived);

    // listen to local state updates and broadcast
    const stopStateListener = systemRegistry.onState(async (env) => {
      // Only broadcast if we are the originator
      if (env.origin !== 'browser') return;

      try {
        const msg = JSON.stringify(env);
        await this.room.localParticipant.publishData(new TextEncoder().encode(msg), {
          reliable: true,
          topic: this.topic,
        });
      } catch (error) {
        // Silently ignore if the connection is closed
        if (error instanceof Error && error.message.includes('PC manager is closed')) {
          // Connection is closed, this is expected when room is disconnecting
          return;
        }
        console.warn('[LiveKit State Bridge] Failed to publish data:', error);
      }
    });

    this.stop = () => {
      this.room.off(RoomEvent.DataReceived, onDataReceived);
      stopStateListener();
      this.stop = null;
    };

    return this.stop;
  }
}

type BridgeAttachment = {
  refs: number;
  stop: StopLiveKitStateBridge;
};

const attachmentsByRoom = new WeakMap<Room, BridgeAttachment>();

export function attachLiveKitStateBridge(room: Room): StopLiveKitStateBridge {
  const existing = attachmentsByRoom.get(room);
  if (existing) {
    existing.refs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      existing.refs -= 1;
      if (existing.refs > 0) return;
      existing.stop();
      attachmentsByRoom.delete(room);
    };
  }

  const bridge = new LiveKitStateBridge(room);
  const attachment: BridgeAttachment = {
    refs: 1,
    stop: bridge.start(),
  };
  attachmentsByRoom.set(room, attachment);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    attachment.refs -= 1;
    if (attachment.refs > 0) return;
    attachment.stop();
    attachmentsByRoom.delete(room);
  };
}

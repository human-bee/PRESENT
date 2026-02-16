import { ParticipantKind, RoomEvent } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

type Listener = (...args: unknown[]) => void;

function createMockRoom(options?: {
  sid?: string;
  state?: string;
  publishData?: jest.Mock;
}) {
  const listeners = new Map<unknown, Set<Listener>>();
  const publishData =
    options?.publishData ??
    jest.fn().mockResolvedValue(undefined);

  const room = {
    sid: options?.sid ?? `room-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test-room',
    state: options?.state ?? 'connected',
    remoteParticipants: new Map<string, unknown>(),
    localParticipant: {
      publishData,
      identity: 'local-user',
    },
    on: jest.fn((event: unknown, handler: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(event, set);
    }),
    off: jest.fn((event: unknown, handler: Listener) => {
      listeners.get(event)?.delete(handler);
    }),
    emit(event: unknown, ...args: unknown[]) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(...args);
      }
    },
  } as any;

  return { room, publishData };
}

describe('createLiveKitBus', () => {
  it('treats async publishData rejections as queued retryable delivery', async () => {
    const { room } = createMockRoom({
      publishData: jest.fn().mockRejectedValue(new Error('UnexpectedConnectionState: PC manager is closed')),
    });
    const bus = createLiveKitBus(room);

    const result = await bus.sendWithResult('tool_call', { ok: true });

    expect(result.status).toBe('queued');
    expect(result.reason).toBe('publish_retry_queued');
  });

  it('queues payloads while room is disconnected', async () => {
    const { room, publishData } = createMockRoom({ state: 'disconnected' });
    const bus = createLiveKitBus(room);

    const result = await bus.sendWithResult('tool_call', { ping: 'pong' });

    expect(result.status).toBe('queued');
    expect(result.reason).toBe('room_not_connected');
    expect(result.queueLength).toBeGreaterThanOrEqual(1);
    expect(publishData).not.toHaveBeenCalled();
  });

  it('queues manual transcripts until a voice agent participant joins', async () => {
    const { room, publishData } = createMockRoom();
    const bus = createLiveKitBus(room);

    const queued = await bus.sendWithResult('transcription', {
      manual: true,
      text: 'hello',
    });

    expect(queued.status).toBe('queued');
    expect(queued.reason).toBe('agent_not_joined');

    room.remoteParticipants.set('voice-agent-1', {
      kind: ParticipantKind.AGENT,
      identity: 'voice-agent-1',
      metadata: '{"type":"agent"}',
    });

    room.emit(RoomEvent.ParticipantConnected, {
      kind: ParticipantKind.AGENT,
      identity: 'voice-agent-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publishData).toHaveBeenCalled();
  });
});

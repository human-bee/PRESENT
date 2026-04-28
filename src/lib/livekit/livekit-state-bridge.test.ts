import { type Room, RoomEvent } from 'livekit-client';
import { attachLiveKitStateBridge, LiveKitStateBridge } from '@/lib/livekit/livekit-state-bridge';
import { systemRegistry } from '@/lib/system-registry';

type Listener = (...args: unknown[]) => void;

type MockRoom = Room & {
  emit(event: unknown, ...args: unknown[]): void;
  listenerCount(event: unknown): number;
};

function createMockRoom() {
  const listeners = new Map<unknown, Set<Listener>>();
  const publishData = jest.fn().mockResolvedValue(undefined);
  const room = {
    localParticipant: {
      publishData,
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
      for (const handler of Array.from(handlers)) {
        handler(...args);
      }
    },
    listenerCount(event: unknown) {
      return listeners.get(event)?.size ?? 0;
    },
  } as unknown as MockRoom;

  return { room, publishData };
}

function encode(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe('LiveKitStateBridge', () => {
  it('removes room and registry listeners when stopped', () => {
    const { room, publishData } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const stop = bridge.start();

    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(1);

    systemRegistry.ingestState({
      id: 'livekit-bridge-outbound-cleanup',
      kind: 'component_snapshot',
      payload: { count: 1 },
      version: 1,
      ts: Date.now(),
      origin: 'browser',
    });

    expect(publishData).toHaveBeenCalledTimes(1);

    stop();
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(0);

    systemRegistry.ingestState({
      id: 'livekit-bridge-outbound-cleanup',
      kind: 'component_snapshot',
      payload: { count: 2 },
      version: 2,
      ts: Date.now(),
      origin: 'browser',
    });

    expect(publishData).toHaveBeenCalledTimes(1);
  });

  it('keeps start idempotent for one bridge instance', () => {
    const { room } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const firstStop = bridge.start();
    const secondStop = bridge.start();

    expect(firstStop).toBe(secondStop);
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(1);

    firstStop();
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(0);
  });

  it('stops ingesting inbound room state after cleanup', () => {
    const { room } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const stop = bridge.start();
    const id = 'livekit-bridge-inbound-cleanup';

    room.emit(
      RoomEvent.DataReceived,
      encode({
        id,
        kind: 'remote_state',
        payload: { count: 1 },
        version: 1,
        ts: Date.now(),
        origin: 'agent',
      }),
      { isLocal: false },
      undefined,
      'state_change',
    );

    expect(systemRegistry.getState(id)?.version).toBe(1);

    stop();

    room.emit(
      RoomEvent.DataReceived,
      encode({
        id,
        kind: 'remote_state',
        payload: { count: 2 },
        version: 2,
        ts: Date.now(),
        origin: 'agent',
      }),
      { isLocal: false },
      undefined,
      'state_change',
    );

    expect(systemRegistry.getState(id)?.version).toBe(1);
  });

  it('ignores local browser echo packets', () => {
    const { room } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const stop = bridge.start();
    const id = 'livekit-bridge-local-echo';

    room.emit(
      RoomEvent.DataReceived,
      encode({
        id,
        kind: 'local_echo',
        payload: { count: 1 },
        version: 1,
        ts: Date.now(),
        origin: 'browser',
      }),
      { isLocal: true },
      undefined,
      'state_change',
    );

    expect(systemRegistry.getState(id)).toBeUndefined();
    stop();
  });

  it('does not publish non-browser origin state updates', () => {
    const { room, publishData } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const stop = bridge.start();

    systemRegistry.ingestState({
      id: 'livekit-bridge-non-browser-origin',
      kind: 'remote_state',
      payload: { count: 1 },
      version: 1,
      ts: Date.now(),
      origin: 'agent',
    });

    expect(publishData).not.toHaveBeenCalled();
    stop();
  });

  it('ignores non-state data-channel topics', () => {
    const { room } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const stop = bridge.start();
    const id = 'livekit-bridge-topic-filter';

    room.emit(
      RoomEvent.DataReceived,
      encode({
        id,
        kind: 'remote_state',
        payload: { count: 1 },
        version: 1,
        ts: Date.now(),
        origin: 'agent',
      }),
      { isLocal: false },
      undefined,
      'tool_call',
    );

    expect(systemRegistry.getState(id)).toBeUndefined();
    stop();
  });

  it('ignores state-shaped packets without the state-change topic', () => {
    const { room } = createMockRoom();
    const bridge = new LiveKitStateBridge(room);
    const stop = bridge.start();
    const id = 'livekit-bridge-missing-topic-filter';

    room.emit(
      RoomEvent.DataReceived,
      encode({
        id,
        kind: 'remote_state',
        payload: { count: 1 },
        version: 1,
        ts: Date.now(),
        origin: 'agent',
      }),
      { isLocal: false },
    );

    expect(systemRegistry.getState(id)).toBeUndefined();
    stop();
  });

  it('shares one bridge attachment per room until all callers release it', () => {
    const { room, publishData } = createMockRoom();
    const stopFirst = attachLiveKitStateBridge(room);
    const stopSecond = attachLiveKitStateBridge(room);

    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(1);

    systemRegistry.ingestState({
      id: 'livekit-bridge-shared-attachment',
      kind: 'component_snapshot',
      payload: { count: 1 },
      version: 1,
      ts: Date.now(),
      origin: 'browser',
    });

    expect(publishData).toHaveBeenCalledTimes(1);

    stopFirst();
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(1);

    systemRegistry.ingestState({
      id: 'livekit-bridge-shared-attachment',
      kind: 'component_snapshot',
      payload: { count: 2 },
      version: 2,
      ts: Date.now(),
      origin: 'browser',
    });

    expect(publishData).toHaveBeenCalledTimes(2);

    stopSecond();
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(0);

    systemRegistry.ingestState({
      id: 'livekit-bridge-shared-attachment',
      kind: 'component_snapshot',
      payload: { count: 3 },
      version: 3,
      ts: Date.now(),
      origin: 'browser',
    });

    expect(publishData).toHaveBeenCalledTimes(2);
  });

  it('reattaches cleanly after all callers release a room', () => {
    const { room } = createMockRoom();
    const stopFirst = attachLiveKitStateBridge(room);

    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(1);
    stopFirst();
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(0);

    const stopSecond = attachLiveKitStateBridge(room);
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(1);

    stopSecond();
    expect(room.listenerCount(RoomEvent.DataReceived)).toBe(0);
  });
});

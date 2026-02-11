import {
  buildToolEvent,
  coerceComponentPatch,
  flushPendingToolCallQueue,
  shouldSuppressCanvasDispatch,
  shouldForceReliableUpdate,
} from '../tool-publishing';

describe('voice-agent tool publishing helpers', () => {
  it('builds tool_call events with expected shape', () => {
    const event = buildToolEvent('create_component', { type: 'RetroTimerEnhanced' }, 'room-a');
    expect(event.type).toBe('tool_call');
    expect(event.roomId).toBe('room-a');
    expect(event.payload.tool).toBe('create_component');
    expect(event.payload.params).toEqual({ type: 'RetroTimerEnhanced' });
    expect(typeof event.id).toBe('string');
  });

  it('forces reliable update when instruction patch is present', () => {
    expect(
      shouldForceReliableUpdate('update_component', { patch: { instruction: 'summarize this' } } as any),
    ).toBe(true);
    expect(shouldForceReliableUpdate('update_component', { patch: {} } as any)).toBe(false);
    expect(
      shouldForceReliableUpdate('create_component', { patch: { instruction: 'x' } } as any),
    ).toBe(false);
  });

  it('coerces string patch into instruction fallback when json is invalid', () => {
    expect(coerceComponentPatch('set to 10 minutes')).toEqual({ instruction: 'set to 10 minutes' });
  });

  it('suppresses duplicate canvas dispatches within ttl and prunes stale entries', () => {
    const dispatches = new Map<string, { ts: number; requestId?: string }>();
    expect(
      shouldSuppressCanvasDispatch({
        dispatches,
        roomName: 'room-a',
        message: 'draw a roadmap',
        requestId: 'r-1',
        now: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldSuppressCanvasDispatch({
        dispatches,
        roomName: 'room-a',
        message: 'draw a roadmap',
        requestId: 'r-1',
        now: 2_000,
      }),
    ).toBe(true);
    expect(
      shouldSuppressCanvasDispatch({
        dispatches,
        roomName: 'room-a',
        message: 'draw a roadmap',
        requestId: 'r-2',
        now: 2_100,
      }),
    ).toBe(false);

    for (let i = 0; i < 25; i += 1) {
      shouldSuppressCanvasDispatch({
        dispatches,
        roomName: 'room-a',
        message: `m-${i}`,
        now: 6_500,
        suppressMs: 3_000,
        maxEntries: 20,
      });
    }
    expect(dispatches.has('room-a::draw a roadmap')).toBe(false);
    expect(dispatches.has('room-a::m-24')).toBe(true);
  });

  it('flushes queued tool calls and re-queues when publish fails', async () => {
    const queue = [
      { event: buildToolEvent('create_component', {}, 'room-a'), reliable: true },
      { event: buildToolEvent('update_component', {}, 'room-a'), reliable: false },
    ];

    let publishCount = 0;
    const publish = jest.fn(async () => {
      publishCount += 1;
      return publishCount > 1;
    });

    const firstDrain = await flushPendingToolCallQueue({
      queue,
      isConnected: true,
      publish,
    });
    expect(firstDrain).toBe(false);
    expect(queue).toHaveLength(2);
    expect(queue[0]?.event.payload.tool).toBe('create_component');

    const secondDrain = await flushPendingToolCallQueue({
      queue,
      isConnected: true,
      publish: async () => true,
    });
    expect(secondDrain).toBe(true);
    expect(queue).toHaveLength(0);
  });

  it('does not drain queue while disconnected and preserves entries for reconnect', async () => {
    const queue = [{ event: buildToolEvent('dispatch_to_conductor', {}, 'room-a'), reliable: true }];
    const publish = jest.fn(async () => true);

    const drained = await flushPendingToolCallQueue({
      queue,
      isConnected: false,
      publish,
    });

    expect(drained).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.event.payload.tool).toBe('dispatch_to_conductor');
  });
});

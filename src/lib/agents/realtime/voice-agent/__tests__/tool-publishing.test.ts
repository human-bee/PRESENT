import type { JsonObject } from '@/lib/utils/json-schema';
import {
  buildToolEvent,
  coerceComponentPatch,
  flushPendingToolCallQueue,
  resolveDispatchSuppressionScope,
  shouldSuppressCanvasDispatch,
  shouldForceReliableUpdate,
} from '../tool-publishing';

describe('voice-agent tool publishing helpers', () => {
  it('builds stable core tool_call envelopes for create/update/dispatch tools', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_111);
    try {
      const toolCases: Array<{ tool: string; params: JsonObject }> = [
        {
          tool: 'create_component',
          params: { type: 'Checklist', messageId: 'ui-1', spec: { title: 'Agenda' } },
        },
        {
          tool: 'update_component',
          params: { componentId: 'ui-1', patch: { instruction: 'summarize this' } },
        },
        {
          tool: 'dispatch_to_conductor',
          params: {
            task: 'canvas.quick_text',
            params: { room: 'room-a', text: 'hello from ai', requestId: 'req-1' },
          },
        },
      ];

      for (const entry of toolCases) {
        const event = buildToolEvent(entry.tool, entry.params, 'room-a');
        expect(event).toMatchObject({
          roomId: 'room-a',
          type: 'tool_call',
          payload: {
            tool: entry.tool,
            params: entry.params,
            context: { source: 'voice', timestamp: 1_111 },
          },
          timestamp: 1_111,
          source: 'voice',
        });
        expect(typeof event.id).toBe('string');
        expect(Object.keys(event).sort()).toEqual(['id', 'payload', 'roomId', 'source', 'timestamp', 'type']);
        expect(Object.keys(event.payload).sort()).toEqual(['context', 'params', 'tool']);
        expect(Object.keys(event.payload.context).sort()).toEqual(['source', 'timestamp']);
      }
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('adds optional quick-lane context fields when provided', () => {
    const event = buildToolEvent(
      'canvas_quick_apply',
      {
        room: 'room-a',
        fast_route_type: 'timer',
        message: 'start a 5 minute timer',
      },
      'room-a',
      {
        fast_route_type: 'timer',
        idempotency_key: 'quick-key-1',
        participant_id: 'participant-1',
        experiment_id: 'voice_toolset_factorial_v1',
        variant_id: 'v03',
        assignment_namespace: 'voice_toolset_factorial_v1',
        factor_levels: {
          initial_toolset: 'lean_adaptive',
          lazy_load_policy: 'locked_session',
          instruction_pack: 'capability_explicit',
          harness_mode: 'queue_first',
        },
        assignment_unit: 'room_session',
        assignment_ts: '2026-02-23T03:21:00.000Z',
      },
    );

    expect(event.payload.context).toMatchObject({
      source: 'voice',
      fast_route_type: 'timer',
      idempotency_key: 'quick-key-1',
      participant_id: 'participant-1',
      experiment_id: 'voice_toolset_factorial_v1',
      variant_id: 'v03',
      assignment_namespace: 'voice_toolset_factorial_v1',
      factor_levels: expect.objectContaining({
        initial_toolset: 'lean_adaptive',
        lazy_load_policy: 'locked_session',
      }),
      assignment_unit: 'room_session',
      assignment_ts: '2026-02-23T03:21:00.000Z',
    });
  });

  it('forces reliable update when instruction patch is present', () => {
    expect(
      shouldForceReliableUpdate('update_component', { patch: { instruction: 'summarize this' } }),
    ).toBe(true);
    expect(shouldForceReliableUpdate('update_component', { patch: {} })).toBe(false);
    expect(shouldForceReliableUpdate('create_component', { patch: { instruction: 'x' } })).toBe(false);
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

  it('prefers fairy intent id for duplicate suppression and falls back to request/turn scope', () => {
    const withIntentId = resolveDispatchSuppressionScope({
      task: 'fairy.intent',
      roomName: 'room-a',
      currentTurnId: 7,
      requestId: undefined,
      intentId: 'intent-123',
    });
    expect(withIntentId).toEqual({
      suppressRoomName: 'room-a',
      suppressRequestId: 'intent-123',
    });

    const withoutIds = resolveDispatchSuppressionScope({
      task: 'fairy.intent',
      roomName: 'room-a',
      currentTurnId: 8,
      requestId: undefined,
      intentId: undefined,
    });
    expect(withoutIds).toEqual({
      suppressRoomName: 'room-a::turn:8',
      suppressRequestId: undefined,
    });

    const nonFairyDispatch = resolveDispatchSuppressionScope({
      task: 'canvas.agent_prompt',
      roomName: 'room-a',
      currentTurnId: 9,
      requestId: 'req-1',
      intentId: 'intent-456',
    });
    expect(nonFairyDispatch).toEqual({
      suppressRoomName: 'room-a',
      suppressRequestId: 'req-1',
    });
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

  it('keeps failed entry at the front after partial drain and reports publish errors', async () => {
    const queue = [
      { event: buildToolEvent('create_component', { messageId: 'ui-1' }, 'room-a'), reliable: true },
      {
        event: buildToolEvent('update_component', { componentId: 'ui-1', patch: { text: 'patched' } }, 'room-a'),
        reliable: false,
      },
      {
        event: buildToolEvent(
          'dispatch_to_conductor',
          { task: 'canvas.quick_text', params: { room: 'room-a', text: 'next' } },
          'room-a',
        ),
        reliable: true,
      },
    ];
    const publishError = new Error('simulated publish error');
    const onPublishError = jest.fn();
    const publish = jest.fn(async (entry: { event: { payload: { tool: string } } }) => {
      if (entry.event.payload.tool === 'update_component') {
        throw publishError;
      }
      return true;
    });

    const drained = await flushPendingToolCallQueue({
      queue,
      isConnected: true,
      publish,
      onPublishError,
    });

    expect(drained).toBe(false);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(onPublishError).toHaveBeenCalledTimes(1);
    expect(onPublishError.mock.calls[0]?.[0]).toBe(publishError);
    expect(onPublishError.mock.calls[0]?.[1]).toMatchObject({
      event: { payload: { tool: 'update_component' } },
    });
    expect(queue).toHaveLength(2);
    expect(queue[0]?.event.payload.tool).toBe('update_component');
    expect(queue[1]?.event.payload.tool).toBe('dispatch_to_conductor');
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

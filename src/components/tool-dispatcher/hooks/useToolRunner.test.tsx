import { shouldDeferToolCallWhenNotExecutor, shouldExecuteIncomingToolCall } from './tool-call-execution-guard';

describe('shouldExecuteIncomingToolCall', () => {
  it('skips execution for non-executor clients', () => {
    const processed = new Map<string, number>();
    const result = shouldExecuteIncomingToolCall({
      isExecutor: false,
      processed,
      roomKey: 'canvas-room',
      callId: 'c1',
      now: 1000,
    });
    expect(result.execute).toBe(false);
    expect(result.reason).toBe('not_executor');
    expect(processed.size).toBe(0);
  });

  it('dedupes already-processed call ids within ttl', () => {
    const processed = new Map<string, number>([['canvas-room:c1', 1000]]);
    const result = shouldExecuteIncomingToolCall({
      isExecutor: true,
      processed,
      roomKey: 'canvas-room',
      callId: 'c1',
      now: 1500,
      ttlMs: 120000,
    });
    expect(result.execute).toBe(false);
    expect(result.reason).toBe('deduped');
  });

  it('allows execution after dedupe ttl expiry', () => {
    const processed = new Map<string, number>([['canvas-room:c1', 1000]]);
    const result = shouldExecuteIncomingToolCall({
      isExecutor: true,
      processed,
      roomKey: 'canvas-room',
      callId: 'c1',
      now: 130001,
      ttlMs: 120000,
    });
    expect(result.execute).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(processed.has('canvas-room:c1')).toBe(true);
  });
});

describe('shouldDeferToolCallWhenNotExecutor', () => {
  it('defers when no executor identity is known yet', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'not_executor',
        executorIdentity: null,
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(true);
  });

  it('defers when executor identity already matches local identity', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'not_executor',
        executorIdentity: 'Canvas-User-1',
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(true);
  });

  it('does not defer when another executor is known', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'not_executor',
        executorIdentity: 'Canvas-User-2',
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(false);
  });

  it('does not defer deduped calls', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'deduped',
        executorIdentity: null,
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(false);
  });
});

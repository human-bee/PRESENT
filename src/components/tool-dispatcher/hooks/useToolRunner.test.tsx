import { shouldExecuteIncomingToolCall } from './tool-call-execution-guard';

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

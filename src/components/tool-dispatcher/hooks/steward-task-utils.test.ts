import { describe, expect, it } from '@jest/globals';
import {
  hasExceededServerErrorBudget,
  readTaskTraceId,
  resolveDispatchRoom,
} from './steward-task-utils';

describe('resolveDispatchRoom', () => {
  it('flags mismatch when call room differs from active room', () => {
    const result = resolveDispatchRoom({
      callRoomId: 'canvas-old-room',
      activeRoomName: 'canvas-new-room',
    });

    expect(result.hasRoomMismatch).toBe(true);
    expect(result.targetRoom).toBe('canvas-old-room');
  });

  it('uses active room when call room is absent', () => {
    const result = resolveDispatchRoom({
      callRoomId: null,
      activeRoomName: 'canvas-primary',
    });

    expect(result.hasRoomMismatch).toBe(false);
    expect(result.targetRoom).toBe('canvas-primary');
  });
});

describe('readTaskTraceId', () => {
  it('prefers camelCase traceId from task payloads', () => {
    const traceId = readTaskTraceId({
      traceId: 'trace-camel',
      trace_id: 'trace-snake',
    });
    expect(traceId).toBe('trace-camel');
  });

  it('falls back to snake_case trace_id', () => {
    const traceId = readTaskTraceId({
      trace_id: 'trace-snake',
    });
    expect(traceId).toBe('trace-snake');
  });
});

describe('hasExceededServerErrorBudget', () => {
  it('terminalizes when count reaches configured max', () => {
    expect(hasExceededServerErrorBudget(5, 5)).toBe(true);
    expect(hasExceededServerErrorBudget(4, 5)).toBe(false);
  });
});

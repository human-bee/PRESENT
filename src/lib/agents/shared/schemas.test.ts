import {
  parseJsonObject,
  queueTaskEnvelopeSchema,
  stewardRunCanvasRequestSchema,
  stewardRunScorecardRequestSchema,
} from '@/lib/agents/shared/schemas';

describe('agent shared schemas', () => {
  it('accepts valid queue envelopes', () => {
    const parsed = queueTaskEnvelopeSchema.parse({
      room: 'room-1',
      task: 'conductor.dispatch',
      params: { room: 'room-1' },
      resourceKeys: ['room:room-1'],
      executionId: 'exec-1',
      idempotencyKey: 'idem-1',
      lockKey: 'widget:abc',
      attempt: 1,
    });

    expect(parsed.room).toBe('room-1');
    expect(parsed.priority).toBe(0);
    expect(parsed.executionId).toBe('exec-1');
    expect(parsed.idempotencyKey).toBe('idem-1');
    expect(parsed.lockKey).toBe('widget:abc');
    expect(parsed.attempt).toBe(1);
  });

  it('rejects invalid queue envelopes', () => {
    const result = queueTaskEnvelopeSchema.safeParse({
      task: 'conductor.dispatch',
      params: {},
    });

    expect(result.success).toBe(false);
  });

  it('parses canvas steward requests', () => {
    const parsed = stewardRunCanvasRequestSchema.parse({
      room: 'room-2',
      message: 'add swimlanes',
      params: { room: 'room-2' },
      requestId: 'intent-1',
      traceId: 'trace-1',
    });

    expect(parsed.room).toBe('room-2');
    expect(parsed.requestId).toBe('intent-1');
    expect(parsed.traceId).toBe('trace-1');
  });

  it('parses scorecard steward requests', () => {
    const parsed = stewardRunScorecardRequestSchema.parse({
      room: 'room-3',
      componentId: 'cmp-1',
      intent: 'scorecard.run',
      executionId: 'exec-score',
      idempotencyKey: 'idem-score',
      lockKey: 'widget:cmp-1',
    });

    expect(parsed.componentId).toBe('cmp-1');
    expect(parsed.executionId).toBe('exec-score');
    expect(parsed.idempotencyKey).toBe('idem-score');
  });

  it('parseJsonObject returns null for non-objects', () => {
    expect(parseJsonObject('x')).toBeNull();
    expect(parseJsonObject(null)).toBeNull();
    expect(parseJsonObject({ ok: true })).toEqual({ ok: true });
  });
});

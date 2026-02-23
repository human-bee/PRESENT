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
      provider: 'openai',
      model: 'openai:gpt-5',
      taskId: 'task-1',
      attempt: 2,
      experiment_id: 'voice_toolset_factorial_v1',
      variant_id: 'v04',
      assignment_namespace: 'voice_toolset_factorial_v1',
      assignment_unit: 'room_session',
      assignment_ts: '2026-02-23T03:21:00.000Z',
      factor_levels: {
        initial_toolset: 'lean_adaptive',
      },
    });

    expect(parsed.room).toBe('room-2');
    expect(parsed.requestId).toBe('intent-1');
    expect(parsed.traceId).toBe('trace-1');
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('openai:gpt-5');
    expect(parsed.taskId).toBe('task-1');
    expect(parsed.attempt).toBe(2);
    expect(parsed.experiment_id).toBe('voice_toolset_factorial_v1');
    expect(parsed.variant_id).toBe('v04');
    expect(parsed.factor_levels).toEqual({ initial_toolset: 'lean_adaptive' });
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

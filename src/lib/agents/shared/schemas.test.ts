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
    });

    expect(parsed.room).toBe('room-1');
    expect(parsed.priority).toBe(0);
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
    });

    expect(parsed.room).toBe('room-2');
  });

  it('parses scorecard steward requests', () => {
    const parsed = stewardRunScorecardRequestSchema.parse({
      room: 'room-3',
      componentId: 'cmp-1',
      intent: 'scorecard.run',
    });

    expect(parsed.componentId).toBe('cmp-1');
  });

  it('parseJsonObject returns null for non-objects', () => {
    expect(parseJsonObject('x')).toBeNull();
    expect(parseJsonObject(null)).toBeNull();
    expect(parseJsonObject({ ok: true })).toEqual({ ok: true });
  });
});

import {
  ACTION_VERSION,
  AgentActionEnvelopeSchema,
  AgentTraceEventSchema,
} from '@/lib/canvas-agent/contract/types';

describe('canvas action contract', () => {
  it('accepts valid envelopes', () => {
    const parsed = AgentActionEnvelopeSchema.safeParse({
      v: ACTION_VERSION,
      sessionId: 'session-1',
      seq: 1,
      actions: [{ id: 'a1', name: 'create_shape', params: { type: 'geo' } }],
      ts: Date.now(),
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects malformed envelopes', () => {
    const parsed = AgentActionEnvelopeSchema.safeParse({
      v: ACTION_VERSION,
      sessionId: 'session-1',
      seq: 1,
      actions: [{ id: 'a1', name: 'not_real_action', params: {} }],
      ts: Date.now(),
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts valid trace events', () => {
    const parsed = AgentTraceEventSchema.safeParse({
      type: 'agent:trace',
      sessionId: 'session-1',
      step: 'actions_dispatched',
      at: Date.now(),
      traceId: 'trace-1',
      intentId: 'intent-1',
      requestId: 'request-1',
      seq: 2,
      partial: false,
      actionCount: 3,
      detail: { verbs: ['create_shape', 'align'] },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid trace events', () => {
    const parsed = AgentTraceEventSchema.safeParse({
      type: 'agent:trace',
      sessionId: 'session-1',
      step: 'not-a-step',
      at: Date.now(),
    });
    expect(parsed.success).toBe(false);
  });
});

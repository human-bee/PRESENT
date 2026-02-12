import { ACTION_VERSION, AgentActionEnvelopeSchema } from '@/lib/canvas-agent/contract/types';

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
});

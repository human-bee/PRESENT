const mockRouteFairyIntent = jest.fn();
const mockNormalizeFairyIntent = jest.fn((input) => input);

jest.mock('@/lib/fairy-intent', () => {
  const { z } = require('zod') as typeof import('zod');
  return {
    FairyBoundsSchema: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })
      .strict(),
    normalizeFairyIntent: (...args: unknown[]) => mockNormalizeFairyIntent(...args),
    routeFairyIntent: (...args: unknown[]) => mockRouteFairyIntent(...args),
  };
});

describe('swarm policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteFairyIntent.mockResolvedValue({
      kind: 'canvas',
      confidence: 0.2,
      message: 'fallback',
    });
  });

  it('returns explicit task directly when provided', async () => {
    const { buildSwarmDecision } = await import('@/lib/agents/swarm/policy');
    const decision = await buildSwarmDecision('scorecard.run', { room: 'r1' });

    expect(decision.task).toBe('scorecard.run');
    expect(decision.reason).toBe('explicit_task');
    expect(mockRouteFairyIntent).not.toHaveBeenCalled();
  });

  it('uses speculative search when confidence is low and message asks for sources', async () => {
    const { buildSwarmDecision } = await import('@/lib/agents/swarm/policy');
    const decision = await buildSwarmDecision('conductor.dispatch', {
      room: 'r1',
      message: 'research this and add sources',
    });

    expect(decision.kind).toBe('search');
    expect(decision.task).toBe('search.bundle');
    expect(decision.reason).toBe('speculative_search_hint');
  });

  it('keeps primary route when confidence is above threshold', async () => {
    mockRouteFairyIntent.mockResolvedValue({
      kind: 'canvas',
      confidence: 0.95,
      message: 'high confidence',
    });
    const { buildSwarmDecision } = await import('@/lib/agents/swarm/policy');
    const decision = await buildSwarmDecision('auto', {
      room: 'r1',
      message: 'search with citations',
    });

    expect(decision.kind).toBe('canvas');
    expect(decision.task).toBe('canvas.agent_prompt');
    expect(decision.reason).toBe('fairy:canvas');
  });

  it('drops invalid bounds before intent normalization', async () => {
    const { buildSwarmDecision } = await import('@/lib/agents/swarm/policy');
    await buildSwarmDecision('conductor.dispatch', {
      room: 'r1',
      message: 'draw',
      bounds: { x: 0, y: 0, w: 'bad' },
    });

    expect(mockNormalizeFairyIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        bounds: undefined,
      }),
    );
  });
});

const mockBuildSwarmDecision = jest.fn();
const mockRecordAgentTraceEvent = jest.fn();

jest.mock('@/lib/agents/swarm/policy', () => ({
  buildSwarmDecision: (...args: unknown[]) => mockBuildSwarmDecision(...args),
}));

jest.mock('@/lib/agents/shared/trace-events', () => ({
  recordAgentTraceEvent: (...args: unknown[]) => mockRecordAgentTraceEvent(...args),
}));

describe('swarm orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSwarmDecision.mockResolvedValue({
      kind: 'canvas',
      task: 'canvas.agent_prompt',
      confidence: 0.91,
      reason: 'fairy:canvas',
    });
    mockRecordAgentTraceEvent.mockResolvedValue(undefined);
  });

  it('routes via policy and executes legacy task', async () => {
    const executeLegacy = jest.fn(async () => ({ ok: true }));
    const { createSwarmOrchestrator } = await import('@/lib/agents/swarm/orchestrator');
    const orchestrator = createSwarmOrchestrator({ executeLegacy });

    const result = await orchestrator.execute({
      taskName: 'fairy.intent',
      requestId: 'req-1',
      params: {
        room: 'room-1',
        message: 'draw',
      },
    });

    expect(result).toEqual({ ok: true });
    expect(mockBuildSwarmDecision).toHaveBeenCalledWith('fairy.intent', {
      room: 'room-1',
      message: 'draw',
    });
    expect(executeLegacy).toHaveBeenCalledWith('canvas.agent_prompt', {
      room: 'room-1',
      message: 'draw',
    });
    expect(mockRecordAgentTraceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'routed',
        task: 'canvas.agent_prompt',
        requestId: 'req-1',
      }),
    );
  });

  it('merges nested params from conductor.dispatch envelopes', async () => {
    const executeLegacy = jest.fn(async () => ({ ok: true }));
    const { createSwarmOrchestrator } = await import('@/lib/agents/swarm/orchestrator');
    const orchestrator = createSwarmOrchestrator({ executeLegacy });

    await orchestrator.execute({
      taskName: 'conductor.dispatch',
      requestId: 'req-2',
      params: {
        room: 'outer-room',
        params: {
          room: 'inner-room',
          message: 'nested',
        },
      },
    });

    expect(executeLegacy).toHaveBeenCalledWith('canvas.agent_prompt', {
      room: 'inner-room',
      params: {
        room: 'inner-room',
        message: 'nested',
      },
      message: 'nested',
    });
  });
});

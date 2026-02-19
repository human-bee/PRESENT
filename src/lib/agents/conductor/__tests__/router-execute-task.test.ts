const mockCreateSwarmOrchestrator = jest.fn();
const mockSwarmExecute = jest.fn();
const mockRouteFairyIntent = jest.fn();

jest.mock('@openai/agents', () => ({
  run: jest.fn(),
}));

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  broadcastAgentPrompt: jest.fn(),
  broadcastToolCall: jest.fn(),
  getDebateScorecard: jest.fn(async () => ({ version: 0, state: null })),
  commitDebateScorecard: jest.fn(async (_room: string, _componentId: string, payload: { state: unknown }) => ({
    version: 1,
    state: payload.state,
  })),
}));

jest.mock('@/lib/agents/subagents/flowchart-steward-registry', () => ({
  activeFlowchartSteward: {},
}));

jest.mock('@/lib/agents/subagents/canvas-steward', () => ({
  runCanvasSteward: jest.fn(async () => ({ status: 'ok' })),
}));

jest.mock('@/lib/agents/shared/queue', () => ({
  AgentTaskQueue: jest.fn().mockImplementation(() => ({
    enqueueTask: jest.fn(async () => ({ id: 'task-1' })),
  })),
}));

jest.mock('@/lib/agents/debate-judge', () => ({
  runDebateScorecardSteward: jest.fn(async () => ({ status: 'ok' })),
  seedScorecardState: jest.fn(),
}));

jest.mock('@/lib/agents/subagents/debate-steward-fast', () => ({
  runDebateScorecardStewardFast: jest.fn(async () => ({ status: 'ok' })),
}));

jest.mock('@/lib/agents/fast-steward-config', () => ({
  isFastStewardReady: jest.fn(() => true),
  getModelForSteward: jest.fn(() => 'debug/fake'),
}));

jest.mock('@/lib/agents/subagents/search-steward', () => ({
  runSearchSteward: jest.fn(async () => ({ status: 'ok' })),
}));

jest.mock('@/lib/agents/subagents/summary-steward-fast', () => ({
  runSummaryStewardFast: jest.fn(async () => ({ status: 'ok' })),
}));

jest.mock('@/lib/agents/subagents/crowd-pulse-steward-fast', () => ({
  runCrowdPulseStewardFast: jest.fn(async () => ({ status: 'ok' })),
}));

jest.mock('@/lib/agents/shared/user-model-keys', () => ({
  getDecryptedUserModelKey: jest.fn(async () => null),
}));

jest.mock('@/lib/fairy-intent', () => {
  const actual = jest.requireActual('@/lib/fairy-intent');
  return {
    ...actual,
    routeFairyIntent: (...args: unknown[]) => mockRouteFairyIntent(...args),
  };
});

jest.mock('@/lib/agents/swarm/orchestrator', () => ({
  createSwarmOrchestrator: (...args: unknown[]) => mockCreateSwarmOrchestrator(...args),
}));

describe('conductor router executeTask', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRouteFairyIntent.mockResolvedValue({
      kind: 'crowd_pulse',
      confidence: 0.6,
      message: 'route to crowd pulse',
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost/supabase';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';
    mockCreateSwarmOrchestrator.mockImplementation(() => ({
      execute: (...args: unknown[]) => mockSwarmExecute(...args),
    }));
  });

  it('uses legacy execution when swarm orchestration is disabled', async () => {
    const { flags } = await import('@/lib/feature-flags');
    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await expect(executeTask('unknown.task', {})).rejects.toThrow('No steward for task: unknown.task');
    expect(mockCreateSwarmOrchestrator).not.toHaveBeenCalled();
  });

  it('routes via swarm orchestrator when swarm orchestration is enabled', async () => {
    const expected = { status: 'ok' };
    mockSwarmExecute.mockResolvedValue(expected);

    const { flags } = await import('@/lib/feature-flags');
    flags.swarmOrchestrationEnabled = true;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    const result = await executeTask('conductor.dispatch', { task: 'auto' });
    expect(result).toEqual(expected);
    expect(mockCreateSwarmOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockSwarmExecute).toHaveBeenCalledWith({
      taskName: 'conductor.dispatch',
      params: { task: 'auto' },
    });
  });

  it('forces draw/sticky fairy intents through canvas execution lane', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-bunny',
        room: 'canvas-room-1',
        message: 'Draw a bunny on the canvas and add a sticky note saying BUNNY_LOOKS_ENERGETIC.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.agent_prompt',
      params: expect.objectContaining({
        room: 'canvas-room-1',
        message: 'Draw a bunny on the canvas and add a sticky note saying BUNNY_LOOKS_ENERGETIC.',
        requestId: 'intent-bunny',
      }),
    });
  });
});

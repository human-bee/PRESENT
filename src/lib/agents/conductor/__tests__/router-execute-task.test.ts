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

  it('routes sticky intents with exact text to canvas.quick_text', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-sticky',
        room: 'canvas-room-2',
        message:
          'Use the fast Cerebras fairy path and add one sticky note near the bunny with exact text: BUNNY_LOOKS_ENERGETIC.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.quick_text',
      params: expect.objectContaining({
        room: 'canvas-room-2',
        text: 'BUNNY_LOOKS_ENERGETIC',
        shapeType: 'note',
        targetHint: 'bunny',
        requestId: 'intent-sticky',
      }),
    });
  });

  it('routes forest sticky intents with target hint to canvas.quick_text', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-sticky-forest',
        room: 'canvas-room-3',
        message:
          'Use the fast Cerebras fairy path and add one sticky note near the forest with exact text: FOREST_READY.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.quick_text',
      params: expect.objectContaining({
        room: 'canvas-room-3',
        text: 'FOREST_READY',
        shapeType: 'note',
        targetHint: 'forest',
        requestId: 'intent-sticky-forest',
      }),
    });
  });

  it('routes sticky intents without colon and preserves id/coordinates', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-sticky-id-coords',
        room: 'canvas-room-5',
        message:
          'Use the fast Cerebras fairy path and ensure one sticky note with id sticky-bunny at x=130 y=-70 and exact text BUNNY_LOOKS_ENERGETIC. If sticky-bunny already exists, update it and do not duplicate.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.quick_text',
      params: expect.objectContaining({
        room: 'canvas-room-5',
        text: 'BUNNY_LOOKS_ENERGETIC',
        shapeType: 'note',
        shapeId: 'sticky-bunny',
        x: 130,
        y: -70,
        targetHint: 'bunny',
        requestId: 'intent-sticky-id-coords',
      }),
    });
  });

  it('routes deterministic bunny geometry intents to canvas.quick_shapes', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-bunny-quick-shapes',
        room: 'canvas-room-6',
        message:
          'Have the fairies draw a clean bunny outline with TLDraw shapes only and these exact ids plus coordinates: bunny-body ellipse at x=-80 y=40 w=160 h=120, bunny-head circle at x=-60 y=-60 w=120 h=120, bunny-ear-left line from -30,-160 to -20,-60, bunny-ear-right line from 30,-160 to 20,-60, bunny-tail small circle at x=90 y=100 w=40 h=40.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.quick_shapes',
      params: expect.objectContaining({
        room: 'canvas-room-6',
        requestId: 'intent-bunny-quick-shapes',
        actions: expect.arrayContaining([
          expect.objectContaining({
            name: 'create_shape',
            params: expect.objectContaining({
              id: 'bunny-body',
              type: 'ellipse',
              x: -80,
              y: 40,
            }),
          }),
          expect.objectContaining({
            name: 'create_shape',
            params: expect.objectContaining({
              id: 'bunny-ear-left',
              type: 'line',
              x: -30,
              y: -160,
            }),
          }),
          expect.objectContaining({
            name: 'create_shape',
            params: expect.objectContaining({
              id: 'bunny-tail',
              type: 'ellipse',
              x: 90,
              y: 100,
            }),
          }),
        ]),
      }),
    });
  });

  it('parses deterministic geometry ids with "with id ... as a ..." phrasing', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-forest-ground-quick-shapes',
        room: 'canvas-room-7',
        message:
          'Use multiple fairies to draw one ground strip with id forest-ground as a green rectangle at x=-240 y=170 w=500 h=8. If forest-ground already exists, update it instead of duplicating.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.quick_shapes',
      params: expect.objectContaining({
        room: 'canvas-room-7',
        requestId: 'intent-forest-ground-quick-shapes',
        actions: expect.arrayContaining([
          expect.objectContaining({
            name: 'create_shape',
            params: expect.objectContaining({
              id: 'forest-ground',
              type: 'rectangle',
              x: -240,
              y: 170,
            }),
          }),
        ]),
      }),
    });
  });

  it('falls back to intent text when fairy.intent message is missing', async () => {
    const { flags } = await import('@/lib/feature-flags');
    const { runCanvasSteward } = await import('@/lib/agents/subagents/canvas-steward');

    flags.swarmOrchestrationEnabled = false;
    const { executeTask } = await import('@/lib/agents/conductor/router');

    await executeTask('conductor.dispatch', {
      task: 'fairy.intent',
      params: {
        id: 'intent-fallback-message',
        room: 'canvas-room-4',
        intent: 'Draw a clean bunny outline with tldraw shapes.',
        source: 'voice',
      },
    });

    expect(runCanvasSteward).toHaveBeenCalledWith({
      task: 'canvas.agent_prompt',
      params: expect.objectContaining({
        room: 'canvas-room-4',
        message: 'Draw a clean bunny outline with tldraw shapes.',
        requestId: 'intent-fallback-message',
      }),
    });
  });
});

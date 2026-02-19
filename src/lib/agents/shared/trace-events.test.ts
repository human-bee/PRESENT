const createClientMock = jest.fn();
const loggerWarnMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

jest.mock('@/lib/feature-flags', () => ({
  flags: {
    agentTraceLedgerEnabled: true,
    agentTraceSampleRate: 1,
  },
}));

jest.mock('@/lib/logging', () => ({
  createLogger: () => ({
    warn: loggerWarnMock,
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('trace events compatibility writes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    createClientMock.mockReset();
    loggerWarnMock.mockReset();
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('learns missing model column once and omits it on future inserts', async () => {
    const insertMock = jest
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'PGRST204',
          message: "Could not find the 'model' column of 'agent_trace_events' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null });
    createClientMock.mockReturnValue({
      from: jest.fn(() => ({ insert: insertMock })),
    });

    const { recordAgentTraceEvent } = await import('./trace-events');
    const input = {
      stage: 'queued' as const,
      task: 'fairy.intent',
      room: 'canvas-room-1',
      requestId: 'req-1',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    };

    await recordAgentTraceEvent(input);
    await recordAgentTraceEvent({ ...input, requestId: 'req-2' });

    expect(insertMock).toHaveBeenCalledTimes(3);
    expect(insertMock.mock.calls[0]?.[0]).toHaveProperty('model', 'claude-haiku-4-5');
    expect(insertMock.mock.calls[1]?.[0]).not.toHaveProperty('model');
    expect(insertMock.mock.calls[2]?.[0]).not.toHaveProperty('model');
  });

  it('drops sampled column when the table does not support it', async () => {
    const insertMock = jest
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: '42703',
          message: 'column "sampled" of relation "agent_trace_events" does not exist',
        },
      })
      .mockResolvedValueOnce({ error: null });
    createClientMock.mockReturnValue({
      from: jest.fn(() => ({ insert: insertMock })),
    });

    const { recordAgentTraceEvent } = await import('./trace-events');
    await recordAgentTraceEvent({
      stage: 'executing',
      task: 'canvas.agent_prompt',
      room: 'canvas-room-2',
      requestId: 'req-3',
    });

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[0]?.[0]).toHaveProperty('sampled', true);
    expect(insertMock.mock.calls[1]?.[0]).not.toHaveProperty('sampled');
  });
});

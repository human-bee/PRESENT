const sendActionsEnvelopeMock = jest.fn();

jest.mock('@/lib/agents/canvas-agent/server/wire', () => ({
  sendActionsEnvelope: (...args: unknown[]) => sendActionsEnvelopeMock(...args),
}));

jest.mock('@/lib/agents/canvas-agent/server/runner', () => ({
  runCanvasAgent: jest.fn(async () => 'ok'),
}));

describe('canvas.quick_text deterministic placement', () => {
  const loadRunCanvasSteward = async () => {
    const module = await import('./canvas-steward');
    return module.runCanvasSteward;
  };

  beforeEach(() => {
    sendActionsEnvelopeMock.mockReset();
    sendActionsEnvelopeMock.mockResolvedValue(undefined);
  });

  it('is deterministic for the same room/request/text payload', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    const params = {
      room: 'canvas-deterministic',
      text: 'BUNNY_LOOKS_ENERGETIC.',
      requestId: 'req-deterministic',
    };

    await runCanvasSteward({ task: 'canvas.quick_text', params });
    await runCanvasSteward({ task: 'canvas.quick_text', params });

    const firstActions = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    const secondActions = sendActionsEnvelopeMock.mock.calls[1]?.[3];

    expect(firstActions).toEqual(secondActions);
    expect(firstActions?.[0]?.params?.x).toEqual(expect.any(Number));
    expect(firstActions?.[0]?.params?.y).toEqual(expect.any(Number));
  });

  it('derives placement from bounds when x/y are not provided', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();

    await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-bounds',
        text: 'FOREST_READY.',
        requestId: 'req-bounds',
        bounds: { x: 100, y: 200, w: 500, h: 400 },
      },
    });

    const actions = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    expect(actions?.[0]?.params?.x).toBe(160);
    expect(actions?.[0]?.params?.y).toBe(256);
  });

  it('uses explicit x/y when provided', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();

    await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-explicit',
        text: 'explicit placement',
        requestId: 'req-explicit',
        x: 333,
        y: -42,
      },
    });

    const actions = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    expect(actions?.[0]?.params?.x).toBe(333);
    expect(actions?.[0]?.params?.y).toBe(-42);
  });
});

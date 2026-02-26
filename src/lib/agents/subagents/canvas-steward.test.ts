const sendActionsEnvelopeMock = jest.fn();
const awaitAckMock = jest.fn();
const runCanvasAgentMock = jest.fn(async () => 'ok');

jest.mock('@/lib/agents/canvas-agent/server/wire', () => ({
  sendActionsEnvelope: (...args: unknown[]) => sendActionsEnvelopeMock(...args),
  awaitAck: (...args: unknown[]) => awaitAckMock(...args),
}));

jest.mock('@/lib/agents/canvas-agent/server/runner', () => ({
  runCanvasAgent: (...args: unknown[]) => runCanvasAgentMock(...args),
}));

describe('canvas.quick_text deterministic placement', () => {
  const loadRunCanvasSteward = async () => {
    const module = await import('./canvas-steward');
    return module.runCanvasSteward;
  };

  beforeEach(() => {
    sendActionsEnvelopeMock.mockReset();
    sendActionsEnvelopeMock.mockResolvedValue({ hash: 'hash-1' });
    awaitAckMock.mockReset();
    awaitAckMock.mockResolvedValue({
      clientId: 'test-client',
      latencyMs: 42,
      envelopeHash: 'hash-1',
    });
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

  it('creates sticky notes when shapeType=note and targetHint=bunny', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();

    await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-sticky',
        text: 'BUNNY_LOOKS_ENERGETIC',
        requestId: 'req-sticky',
        shapeType: 'note',
        targetHint: 'bunny',
      },
    });

    const actions = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    expect(actions?.[0]?.params?.type).toBe('note');
    expect(actions?.[0]?.params?.x).toBe(80);
    expect(actions?.[0]?.params?.y).toBe(-80);
    expect(actions?.[0]?.params?.props?.text).toBe('BUNNY_LOOKS_ENERGETIC');
    expect(actions?.[0]?.params?.props?.color).toBe('yellow');
  });

  it('uses target-aware placement inside bounds', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();

    await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-targeted',
        text: 'FOREST_READY',
        requestId: 'req-targeted',
        shapeType: 'note',
        targetHint: 'forest',
        bounds: { x: 100, y: 200, w: 500, h: 400 },
      },
    });

    const actions = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    expect(actions?.[0]?.params?.x).toBe(460);
    expect(actions?.[0]?.params?.y).toBe(448);
  });

  it('returns queued evidence when quick_text delivery is not acknowledged', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    awaitAckMock.mockResolvedValue(null);

    const result = await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-ack-timeout',
        text: 'ack timeout',
        requestId: 'req-timeout',
      },
    });

    expect(result).toMatchObject({
      status: 'queued',
      reason: 'apply_evidence_pending',
      requestId: 'req-timeout',
      actionCount: 1,
      ack: {
        pending: true,
      },
    });
    expect((result as any).actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'create_shape',
        }),
      ]),
    );
    expect(sendActionsEnvelopeMock).toHaveBeenCalledTimes(2);
  });
});

describe('canvas.quick_shapes deterministic envelope', () => {
  const loadRunCanvasSteward = async () => {
    const module = await import('./canvas-steward');
    return module.runCanvasSteward;
  };

  beforeEach(() => {
    sendActionsEnvelopeMock.mockReset();
    sendActionsEnvelopeMock.mockResolvedValue({ hash: 'hash-shapes' });
    awaitAckMock.mockReset();
    awaitAckMock.mockResolvedValue({
      clientId: 'shape-client',
      latencyMs: 21,
      envelopeHash: 'hash-shapes',
    });
  });

  it('applies deterministic shape actions and returns shape ids', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    const result = await runCanvasSteward({
      task: 'canvas.quick_shapes',
      params: {
        room: 'canvas-quick-shapes',
        requestId: 'req-quick-shapes',
        actions: [
          {
            id: 'det-bunny-body',
            name: 'create_shape',
            params: {
              id: 'bunny-body',
              type: 'ellipse',
              x: -80,
              y: 40,
              props: { w: 160, h: 120, color: 'red', fill: 'none' },
            },
          },
          {
            id: 'det-forest-tree-1',
            name: 'create_shape',
            params: {
              id: 'forest-tree-1',
              type: 'rectangle',
              x: -190,
              y: -20,
              props: { w: 20, h: 170, color: 'green', fill: 'solid' },
            },
          },
        ],
      },
    });

    expect(sendActionsEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(sendActionsEnvelopeMock.mock.calls[0]?.[3]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'det-bunny-body',
          name: 'create_shape',
        }),
      ]),
    );
    expect(result).toMatchObject({
      status: 'applied',
      requestId: 'req-quick-shapes',
      actionCount: 2,
      shapeIds: ['bunny-body', 'forest-tree-1'],
    });
    expect((result as any).actions).toHaveLength(2);
    expect((result as any).actions?.[0]).toEqual(
      expect.objectContaining({
        name: 'create_shape',
      }),
    );
  });

  it('returns queued evidence when quick_shapes delivery is not acknowledged', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    awaitAckMock.mockResolvedValue(null);

    const result = await runCanvasSteward({
      task: 'canvas.quick_shapes',
      params: {
        room: 'canvas-quick-shapes-timeout',
        requestId: 'req-quick-shapes-timeout',
        actions: [
          {
            id: 'det-forest-ground',
            name: 'create_shape',
            params: {
              id: 'forest-ground',
              type: 'rectangle',
              x: -240,
              y: 170,
              props: { w: 500, h: 8, color: 'green', fill: 'solid' },
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: 'queued',
      requestId: 'req-quick-shapes-timeout',
      actionCount: 1,
      reason: 'apply_evidence_pending',
      ack: {
        pending: true,
      },
    });
    expect((result as any).actions).toHaveLength(1);
    expect(sendActionsEnvelopeMock).toHaveBeenCalledTimes(2);
  });

  it('sanitizes line quick_shapes payloads before dispatch', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    await runCanvasSteward({
      task: 'canvas.quick_shapes',
      params: {
        room: 'canvas-quick-shapes-line',
        requestId: 'req-quick-shapes-line',
        actions: [
          {
            id: 'line-sanitize-1',
            name: 'create_shape',
            params: {
              id: 'line-raw',
              type: 'line',
              x: -30,
              y: -160,
              props: {
                endPoint: { x: 20, y: -60 },
                endArrowType: 'arrow',
                color: 'red',
              },
            },
          },
        ],
      },
    });

    const dispatched = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    const params = dispatched?.[0]?.params;
    expect(params?.props?.endPoint).toBeUndefined();
    expect(params?.props?.endArrowType).toBeUndefined();
    expect(params?.props?.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 20, y: -60 },
    });
  });
});

describe('canvas graph fallback', () => {
  const loadRunCanvasSteward = async () => {
    const module = await import('./canvas-steward');
    return module.runCanvasSteward;
  };

  beforeEach(() => {
    sendActionsEnvelopeMock.mockReset();
    sendActionsEnvelopeMock.mockResolvedValue({ hash: 'hash-graph-fallback' });
    awaitAckMock.mockReset();
    awaitAckMock.mockResolvedValue({
      clientId: 'graph-client',
      latencyMs: 33,
      envelopeHash: 'hash-graph-fallback',
    });
    runCanvasAgentMock.mockReset();
    runCanvasAgentMock.mockResolvedValue('ok');
  });

  it('returns degraded fallback result instead of throwing for graph-like failures', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    runCanvasAgentMock.mockRejectedValueOnce(new Error('invalid graph payload'));

    const result = await runCanvasSteward({
      task: 'canvas.agent_prompt',
      params: {
        room: 'canvas-graph',
        message: 'draw a graph of y = 2x + 3',
        requestId: 'req-graph',
      },
    });

    expect(result).toMatchObject({
      status: 'applied',
      degraded: true,
      fallback: 'graph_sketch',
      requestId: 'req-graph',
    });
    expect(sendActionsEnvelopeMock).toHaveBeenCalledTimes(1);
    const dispatchedActions = sendActionsEnvelopeMock.mock.calls[0]?.[3];
    expect(Array.isArray(dispatchedActions)).toBe(true);
    expect(dispatchedActions?.length).toBeGreaterThanOrEqual(3);
    expect(
      dispatchedActions?.some(
        (action: any) =>
          action?.name === 'create_shape' &&
          action?.params?.type === 'line',
      ),
    ).toBe(true);
  });

  it('does not apply graph fallback for non-graph failures', async () => {
    const runCanvasSteward = await loadRunCanvasSteward();
    runCanvasAgentMock.mockRejectedValueOnce(new Error('runner hard failure'));

    await expect(
      runCanvasSteward({
        task: 'canvas.agent_prompt',
        params: {
          room: 'canvas-non-graph',
          message: 'tidy the layout and align elements',
          requestId: 'req-non-graph',
        },
      }),
    ).rejects.toThrow('runner hard failure');
    expect(sendActionsEnvelopeMock).not.toHaveBeenCalled();
  });
});

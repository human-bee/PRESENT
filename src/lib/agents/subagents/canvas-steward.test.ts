import { runCanvasSteward } from './canvas-steward';

const sendActionsEnvelopeMock = jest.fn();

jest.mock('@/lib/agents/canvas-agent/server/runner', () => ({
  runCanvasAgent: jest.fn(),
}));

jest.mock('@/lib/agents/canvas-agent/server/wire', () => ({
  sendActionsEnvelope: (...args: unknown[]) => sendActionsEnvelopeMock(...args),
}));

describe('runCanvasSteward canvas.quick_text', () => {
  beforeEach(() => {
    sendActionsEnvelopeMock.mockReset();
  });

  it('uses deterministic shape id and placement when coordinates are omitted', async () => {
    const params = {
      room: 'canvas-room-1',
      text: 'BUNNY_LOOKS_ENERGETIC',
      requestId: 'req-fixed-123',
    };

    const first = await runCanvasSteward({ task: 'canvas.quick_text', params });
    const firstCall = sendActionsEnvelopeMock.mock.calls[0];
    const firstActions = firstCall?.[3] as Array<Record<string, any>>;
    const firstCreate = firstActions?.[0];

    sendActionsEnvelopeMock.mockReset();

    const second = await runCanvasSteward({ task: 'canvas.quick_text', params });
    const secondCall = sendActionsEnvelopeMock.mock.calls[0];
    const secondActions = secondCall?.[3] as Array<Record<string, any>>;
    const secondCreate = secondActions?.[0];

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(first.shapeId).toBe(second.shapeId);
    expect(firstCreate?.params?.id).toBe(secondCreate?.params?.id);
    expect(firstCreate?.params?.x).toBe(secondCreate?.params?.x);
    expect(firstCreate?.params?.y).toBe(secondCreate?.params?.y);
  });

  it('anchors quick text into viewport bounds when bounds are provided', async () => {
    await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-room-2',
        text: 'FOREST_READY',
        requestId: 'req-bounds-1',
        bounds: { x: 100, y: 200, w: 500, h: 400 },
      },
    });

    const call = sendActionsEnvelopeMock.mock.calls[0];
    const actions = call?.[3] as Array<Record<string, any>>;
    const create = actions?.[0];
    expect(create?.params?.x).toBe(140);
    expect(create?.params?.y).toBe(232);
  });

  it('prefers explicit coordinates over derived placement', async () => {
    await runCanvasSteward({
      task: 'canvas.quick_text',
      params: {
        room: 'canvas-room-3',
        text: 'EXPLICIT_TEXT',
        requestId: 'req-explicit',
        x: -10,
        y: 25,
        bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      },
    });

    const call = sendActionsEnvelopeMock.mock.calls[0];
    const actions = call?.[3] as Array<Record<string, any>>;
    const create = actions?.[0];
    expect(create?.params?.x).toBe(-10);
    expect(create?.params?.y).toBe(25);
  });
});

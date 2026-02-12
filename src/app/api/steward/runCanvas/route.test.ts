/**
 * @jest-environment node
 */
const enqueueTaskMock = jest.fn();
const broadcastAgentPromptMock = jest.fn();

jest.mock('@/lib/agents/shared/queue', () => ({
  AgentTaskQueue: jest.fn().mockImplementation(() => ({
    enqueueTask: enqueueTaskMock,
  })),
}));

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  broadcastAgentPrompt: broadcastAgentPromptMock,
}));

jest.mock('@/lib/agents/subagents/canvas-steward', () => ({
  runCanvasSteward: jest.fn(),
}));

const { POST } = require('./route');

describe('/api/steward/runCanvas', () => {
  beforeEach(() => {
    enqueueTaskMock.mockReset();
    broadcastAgentPromptMock.mockReset();
    enqueueTaskMock.mockResolvedValue({ id: 'task-1' });
    broadcastAgentPromptMock.mockResolvedValue(undefined);
  });

  it('enriches task params with orchestration envelope and lock key', async () => {
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'canvas.agent_prompt',
        params: {
          room: 'demo-room',
          message: 'draw a swimlane',
        },
        idempotencyKey: 'idem-canvas-1',
        executionId: 'exec-canvas-1',
        attempt: 2,
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(202);

    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
    expect(enqueueTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        room: 'demo-room',
        task: 'canvas.agent_prompt',
        requestId: 'idem-canvas-1',
        dedupeKey: 'idem-canvas-1',
        lockKey: 'room:demo-room:canvas',
        idempotencyKey: 'idem-canvas-1',
        resourceKeys: expect.arrayContaining(['room:demo-room', 'lock:room:demo-room:canvas']),
        params: expect.objectContaining({
          room: 'demo-room',
          message: 'draw a swimlane',
          executionId: 'exec-canvas-1',
          idempotencyKey: 'idem-canvas-1',
          lockKey: 'room:demo-room:canvas',
          attempt: 2,
        }),
      }),
    );

    expect(broadcastAgentPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        room: 'demo-room',
        payload: expect.objectContaining({
          message: 'draw a swimlane',
          requestId: 'idem-canvas-1',
        }),
      }),
    );
  });
});

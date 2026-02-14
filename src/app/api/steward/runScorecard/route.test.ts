/**
 * @jest-environment node
 */
const enqueueTaskMock = jest.fn();

jest.mock('@/lib/agents/shared/queue', () => ({
  AgentTaskQueue: jest.fn().mockImplementation(() => ({
    enqueueTask: enqueueTaskMock,
  })),
}));

jest.mock('@/lib/agents/shared/byok-flags', () => ({
  BYOK_ENABLED: false,
}));

const { POST } = require('./route');

describe('/api/steward/runScorecard', () => {
  beforeEach(() => {
    enqueueTaskMock.mockReset();
    enqueueTaskMock.mockResolvedValue({ id: 'task-scorecard-1' });
  });

  it('propagates orchestration envelope fields and serialized lock key', async () => {
    const request = new Request('http://localhost/api/steward/runScorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'scorecard-123',
        task: 'scorecard.run',
        prompt: 'score this claim',
        idempotencyKey: 'idem-score-1',
        executionId: 'exec-score-1',
        attempt: 1,
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(202);

    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
    expect(enqueueTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        room: 'demo-room',
        task: 'scorecard.run',
        requestId: 'idem-score-1',
        dedupeKey: 'idem-score-1',
        lockKey: 'widget:scorecard-123',
        idempotencyKey: 'idem-score-1',
        resourceKeys: expect.arrayContaining([
          'room:demo-room',
          'scorecard:scorecard-123',
          'lock:widget:scorecard-123',
        ]),
        params: expect.objectContaining({
          room: 'demo-room',
          componentId: 'scorecard-123',
          prompt: 'score this claim',
          executionId: 'exec-score-1',
          idempotencyKey: 'idem-score-1',
          lockKey: 'widget:scorecard-123',
          attempt: 1,
        }),
      }),
    );
  });

  it('returns 503 on queue failure (queue-only writer)', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const request = new Request('http://localhost/api/steward/runScorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'scorecard-123',
        task: 'scorecard.run',
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(503);
  });
});

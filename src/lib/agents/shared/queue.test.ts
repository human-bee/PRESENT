import type { JsonObject } from '@/lib/utils/json-schema';

const createClientMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

type QueryStub = {
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  contains: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  update: jest.Mock;
  insert: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
};

type QueryHarness = {
  queries: QueryStub[];
  maybeSingleQueue: Array<{ data: any; error: any }>;
  singleQueue: Array<{ data: any; error: any }>;
};

const createHarness = (): QueryHarness => {
  const queries: QueryStub[] = [];
  const maybeSingleQueue: Array<{ data: any; error: any }> = [];
  const singleQueue: Array<{ data: any; error: any }> = [];
  createClientMock.mockImplementation(() => {
    const supabase = {
      from: jest.fn(() => {
        const query = {} as QueryStub;
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.in = jest.fn(() => query);
        query.contains = jest.fn(() => query);
        query.order = jest.fn(() => query);
        query.limit = jest.fn(() => query);
        query.update = jest.fn(() => query);
        query.insert = jest.fn(() => query);
        query.single = jest.fn(async () => singleQueue.shift() ?? { data: null, error: null });
        query.maybeSingle = jest.fn(async () => maybeSingleQueue.shift() ?? { data: null, error: null });
        queries.push(query);
        return query;
      }),
      rpc: jest.fn(async () => ({ data: null, error: null })),
    };
    return supabase;
  });

  return { queries, maybeSingleQueue, singleQueue };
};

describe('AgentTaskQueue enqueue dedupe behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    createClientMock.mockReset();
  });

  test('returns existing queued task on requestId dedupe pre-check and does not insert', async () => {
    const harness = createHarness();
    const existingTask = {
      id: 'task-existing',
      room: 'room-1',
      task: 'fairy.intent',
      params: {} as JsonObject,
      trace_id: null,
      status: 'queued',
      priority: 0,
      run_at: null,
      attempt: 0,
      error: null,
      request_id: 'req-1',
      dedupe_key: null,
      resource_keys: ['room:room-1'],
      lease_token: null,
      lease_expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result: null,
    };
    harness.maybeSingleQueue.push({ data: existingTask, error: null });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    const result = await queue.enqueueTask({
      room: 'room-1',
      task: 'fairy.intent',
      params: { room: 'room-1', id: 'req-1' },
      requestId: 'req-1',
    });

    expect(result?.id).toBe('task-existing');
    expect(harness.queries).toHaveLength(1);
    expect(harness.queries[0]?.insert).not.toHaveBeenCalled();
    expect(harness.queries[0]?.in).toHaveBeenCalledWith('status', ['queued', 'running']);
  });

  test('on 23505 conflict returns existing task after fallback lookup', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({ data: null, error: { code: '23505' } });
    harness.maybeSingleQueue.push({
      data: {
        id: 'task-from-conflict',
        room: 'room-1',
        task: 'canvas.agent_prompt',
        params: {} as JsonObject,
        trace_id: null,
        status: 'running',
        priority: 0,
        run_at: null,
        attempt: 1,
        error: null,
        request_id: 'req-conflict',
        dedupe_key: null,
        resource_keys: ['room:room-1'],
        lease_token: 'lease-1',
        lease_expires_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: null,
      },
      error: null,
    });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    const result = await queue.enqueueTask({
      room: 'room-1',
      task: 'canvas.agent_prompt',
      params: { room: 'room-1', message: 'draw a cat' },
      requestId: 'req-conflict',
    });

    expect(result?.id).toBe('task-from-conflict');
    expect(harness.queries).toHaveLength(4);
    expect(harness.queries[0]?.in).toHaveBeenCalledWith('status', ['queued', 'running']);
    expect(harness.queries[3]?.in).not.toHaveBeenCalledWith('status', ['queued', 'running']);
  });

  test('retries insert without trace_id when trace_id column is missing', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'trace_id' column of 'agent_tasks' in the schema cache",
      },
    });
    harness.singleQueue.push({
      data: {
        id: 'task-retry-success',
        room: 'room-1',
        task: 'fairy.intent',
        params: {} as JsonObject,
        status: 'queued',
        priority: 0,
        run_at: null,
        attempt: 0,
        error: null,
        request_id: 'req-retry',
        dedupe_key: null,
        resource_keys: ['room:room-1'],
        lease_token: null,
        lease_expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: null,
      },
      error: null,
    });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    const result = await queue.enqueueTask({
      room: 'room-1',
      task: 'fairy.intent',
      params: { room: 'room-1', id: 'req-retry' },
      requestId: 'req-retry',
    });

    expect(result?.id).toBe('task-retry-success');
    expect((result as any)?.trace_id).toBeNull();
    expect(harness.queries).toHaveLength(3);
    expect(harness.queries[1]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ trace_id: expect.any(String) }),
    );
    expect(harness.queries[2]?.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ trace_id: expect.anything() }),
    );
  });

  test('does not coalesce fairy.intent tasks by default', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: {
        id: 'fairy-task',
        room: 'room-1',
        task: 'fairy.intent',
        params: {} as JsonObject,
        status: 'queued',
        priority: 0,
        run_at: null,
        attempt: 0,
        error: null,
        request_id: 'req-fairy',
        dedupe_key: null,
        resource_keys: ['room:room-1'],
        lease_token: null,
        lease_expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: null,
      },
      error: null,
    });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    await queue.enqueueTask({
      room: 'room-1',
      task: 'fairy.intent',
      params: { room: 'room-1', message: 'draw bunny' },
      requestId: 'req-fairy',
    });

    const coalesceCalls = harness.queries.flatMap((query) => query.update.mock.calls);
    expect(coalesceCalls).toHaveLength(0);
  });

  test('coalesces canvas.agent_prompt tasks by default', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: {
        id: 'canvas-task',
        room: 'room-1',
        task: 'canvas.agent_prompt',
        params: {} as JsonObject,
        status: 'queued',
        priority: 0,
        run_at: null,
        attempt: 0,
        error: null,
        request_id: 'req-canvas',
        dedupe_key: null,
        resource_keys: ['room:room-1'],
        lease_token: null,
        lease_expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: null,
      },
      error: null,
    });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    await queue.enqueueTask({
      room: 'room-1',
      task: 'canvas.agent_prompt',
      params: { room: 'room-1', message: 'draw bunny' },
      requestId: 'req-canvas',
    });

    const coalesceCalls = harness.queries.flatMap((query) => query.update.mock.calls);
    expect(coalesceCalls.length).toBeGreaterThan(0);
  });
});

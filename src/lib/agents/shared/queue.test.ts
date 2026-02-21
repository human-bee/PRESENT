import type { JsonObject } from '@/lib/utils/json-schema';

const createClientMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

type QueryStub = {
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  is: jest.Mock;
  not: jest.Mock;
  contains: jest.Mock;
  or: jest.Mock;
  order: jest.Mock;
  lte: jest.Mock;
  limit: jest.Mock;
  update: jest.Mock;
  insert: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
};

type QueryHarness = {
  queries: QueryStub[];
  listQueue: Array<{ data: any; error: any }>;
  maybeSingleQueue: Array<{ data: any; error: any }>;
  singleQueue: Array<{ data: any; error: any }>;
};

const createHarness = (): QueryHarness => {
  const queries: QueryStub[] = [];
  const listQueue: Array<{ data: any; error: any }> = [];
  const maybeSingleQueue: Array<{ data: any; error: any }> = [];
  const singleQueue: Array<{ data: any; error: any }> = [];
  createClientMock.mockImplementation(() => {
    const supabase = {
      from: jest.fn(() => {
        const query = Promise.resolve().then(
          () => listQueue.shift() ?? { data: null, error: null },
        ) as unknown as QueryStub;
        query.select = jest.fn(() => query);
        query.eq = jest.fn(() => query);
        query.in = jest.fn(() => query);
        query.is = jest.fn(() => query);
        query.not = jest.fn(() => query);
        query.contains = jest.fn(() => query);
        query.or = jest.fn(() => query);
        query.order = jest.fn(() => query);
        query.lte = jest.fn(() => query);
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

  return { queries, listQueue, maybeSingleQueue, singleQueue };
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

  test('throws when requireTraceId is true and no trace id can be derived', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });

    await expect(
      queue.enqueueTask({
        room: 'room-1',
        task: 'fairy.intent',
        params: { room: 'room-1', message: 'draw a bunny' },
        requireTraceId: true,
      }),
    ).rejects.toThrow('TRACE_ID_REQUIRED:fairy.intent');

    const insertCalls = harness.queries.reduce((acc, query) => acc + query.insert.mock.calls.length, 0);
    expect(insertCalls).toBe(0);
  });

  test('throws when requireTraceId is true and trace_id column is unavailable', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'trace_id' column of 'agent_tasks' in the schema cache",
      },
    });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });

    await expect(
      queue.enqueueTask({
        room: 'room-1',
        task: 'fairy.intent',
        params: { room: 'room-1', message: 'draw a bunny', traceId: 'trace-1' },
        requestId: 'req-trace-strict',
        requireTraceId: true,
      }),
    ).rejects.toThrow('TRACE_ID_COLUMN_REQUIRED:fairy.intent');

    expect(harness.queries).toHaveLength(2);
    expect(harness.queries[1]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ trace_id: 'trace-1' }),
    );
  });

  test('does not coalesce queued fairy.intent tasks by default', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: {
        id: 'task-fairy',
        room: 'room-1',
        task: 'fairy.intent',
        params: {} as JsonObject,
        trace_id: null,
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
    const result = await queue.enqueueTask({
      room: 'room-1',
      task: 'fairy.intent',
      params: { room: 'room-1', message: 'draw a bunny' },
      requestId: 'req-fairy',
    });

    expect(result?.id).toBe('task-fairy');
    const updateCalls = harness.queries.reduce((acc, query) => acc + query.update.mock.calls.length, 0);
    expect(updateCalls).toBe(0);
  });

  test('coalesces queued canvas.agent_prompt tasks by default', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: {
        id: 'task-canvas',
        room: 'room-1',
        task: 'canvas.agent_prompt',
        params: {} as JsonObject,
        trace_id: null,
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
    const result = await queue.enqueueTask({
      room: 'room-1',
      task: 'canvas.agent_prompt',
      params: { room: 'room-1', message: 'draw roadmap' },
      requestId: 'req-canvas',
    });

    expect(result?.id).toBe('task-canvas');
    const coalesceQuery = harness.queries.find((query) => query.update.mock.calls.length > 0);
    expect(coalesceQuery).toBeDefined();
    expect(coalesceQuery?.in).toHaveBeenCalledWith('task', ['canvas.agent_prompt']);
  });

  test('requeues a leased task without incrementing attempts', async () => {
    const harness = createHarness();
    harness.maybeSingleQueue.push({ data: null, error: null });
    harness.singleQueue.push({
      data: {
        id: 'task-requeue',
        room: 'room-1',
        task: 'fairy.intent',
        params: {} as JsonObject,
        trace_id: null,
        status: 'queued',
        priority: 0,
        run_at: null,
        attempt: 0,
        error: null,
        request_id: 'req-requeue',
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
      params: { room: 'room-1', message: 'draw a bunny' },
      requestId: 'req-requeue',
    });

    const queryCountBeforeRequeue = harness.queries.length;
    await queue.requeueTask('task-requeue', 'lease-1', {
      runAt: new Date('2026-02-19T12:00:00.000Z'),
      resourceKeys: ['room:room-1', 'skip-host:host-a'],
    });

    expect(harness.queries.length).toBe(queryCountBeforeRequeue + 1);
    const requeueQuery = harness.queries[queryCountBeforeRequeue];
    expect(requeueQuery?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        lease_token: null,
        lease_expires_at: null,
        run_at: '2026-02-19T12:00:00.000Z',
        resource_keys: ['room:room-1', 'skip-host:host-a'],
      }),
    );
    expect(requeueQuery?.eq).toHaveBeenCalledWith('id', 'task-requeue');
    expect(requeueQuery?.eq).toHaveBeenCalledWith('lease_token', 'lease-1');
  });

  test('claimLocalScopeTasks reclaims stale leased tasks in local-scope mode', async () => {
    const harness = createHarness();
    const staleLeaseTask = {
      id: 'task-stale-lease',
      room: 'room-local',
      task: 'fairy.intent',
      params: {} as JsonObject,
      trace_id: null,
      status: 'running',
      priority: 5,
      run_at: null,
      attempt: 1,
      error: null,
      request_id: 'req-stale-lease',
      dedupe_key: null,
      resource_keys: ['room:room-local', 'runtime-scope:local', 'queue-mode:local-scope-direct-claim'],
      lease_token: 'stale-lease-token',
      lease_expires_at: '2026-02-19T11:59:00.000Z',
      created_at: '2026-02-19T11:50:00.000Z',
      updated_at: '2026-02-19T11:55:00.000Z',
      result: null,
    };
    harness.listQueue.push({ data: [], error: null });
    harness.listQueue.push({ data: [staleLeaseTask], error: null });
    harness.maybeSingleQueue.push({ data: staleLeaseTask, error: null });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    const result = await queue.claimLocalScopeTasks({ runtimeScope: 'local', limit: 1 });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.id).toBe('task-stale-lease');
    expect(harness.queries).toHaveLength(3);
    const claimUpdateQuery = harness.queries[2];
    expect(claimUpdateQuery?.eq).toHaveBeenCalledWith('lease_token', 'stale-lease-token');
    expect(claimUpdateQuery?.lte).toHaveBeenCalledWith('lease_expires_at', expect.any(String));
  });

  test('claimLocalScopeTasks applies due-time filter before limiting candidate windows', async () => {
    const harness = createHarness();
    harness.listQueue.push({ data: [], error: null });
    harness.listQueue.push({ data: [], error: null });

    const { AgentTaskQueue } = await import('@/lib/agents/shared/queue');
    const queue = new AgentTaskQueue({ url: 'http://localhost:54321', serviceRoleKey: 'test-key' });
    await queue.claimLocalScopeTasks({ runtimeScope: 'local', limit: 2 });

    expect(harness.queries).toHaveLength(2);
    const unleasedQuery = harness.queries[0];
    const staleLeasedQuery = harness.queries[1];
    expect(unleasedQuery?.or).toHaveBeenCalledWith(expect.stringContaining('run_at.is.null'));
    expect(staleLeasedQuery?.or).toHaveBeenCalledWith(expect.stringContaining('run_at.is.null'));
    expect(unleasedQuery?.or.mock.invocationCallOrder[0]).toBeLessThan(unleasedQuery?.limit.mock.invocationCallOrder[0]);
    expect(staleLeasedQuery?.or.mock.invocationCallOrder[0]).toBeLessThan(
      staleLeasedQuery?.limit.mock.invocationCallOrder[0],
    );
  });
});

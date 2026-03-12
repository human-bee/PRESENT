/**
 * @jest-environment node
 */

const requireAgentAdminSignedInUserIdMock = jest.fn();
const getAdminSupabaseClientMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminSignedInUserId: requireAgentAdminSignedInUserIdMock,
}));

jest.mock('@/lib/agents/admin/supabase-admin', () => ({
  getAdminSupabaseClient: getAdminSupabaseClientMock,
}));

const loadGet = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

type QueryResult = { data: unknown[]; error: null | { message: string; code?: string } };
type QueryBuilder = Promise<QueryResult> & {
  select: jest.MockedFunction<(columns?: string) => QueryBuilder>;
  order: jest.MockedFunction<(column: string, options?: { ascending?: boolean }) => QueryBuilder>;
  limit: jest.MockedFunction<(value: number) => QueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
  in: jest.MockedFunction<(column: string, values: string[]) => QueryBuilder>;
};

const buildQuery = (result: QueryResult) => {
  let limitValue: number | null = null;
  const filters: Array<{ column: string; value: string }> = [];
  const inFilters: Array<{ column: string; values: string[] }> = [];
  const query = Promise.resolve(result) as QueryBuilder;
  query.select = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn((value: number) => {
    limitValue = value;
    return query;
  });
  query.eq = jest.fn((column: string, value: string) => {
    filters.push({ column, value });
    return query;
  });
  query.in = jest.fn((column: string, values: string[]) => {
    inFilters.push({ column, values });
    return query;
  });
  return {
    query,
    getLimit: () => limitValue,
    getFilters: () => filters,
    getInFilters: () => inFilters,
  };
};

describe('/api/admin/agents/voice-sessions', () => {
  beforeEach(() => {
    requireAgentAdminSignedInUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
  });

  it('summarizes voice sessions from model and tool replay ledgers', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1' });
    const startedQuery = buildQuery({
      data: [
        {
          session_id: 'voice-1',
          room: 'canvas-room-1',
          trace_id: null,
          request_id: null,
          intent_id: null,
          created_at: '2026-03-11T10:00:00.000Z',
          event_type: 'session_started',
          status: 'running',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: null,
          context_priming: {
            room: 'canvas-room-1',
            transcriptionEnabled: true,
          },
          metadata: {
            workerId: 'worker-1',
            participantIdentity: 'voice-agent-1',
            modelControl: {
              configVersion: 'cfg-1',
              fieldSource: {
                scope: 'global',
                scopeId: 'global',
                profileId: 'profile-1',
              },
            },
          },
          output_payload: null,
          error: null,
        },
      ],
      error: null,
    });
    const modelEventsQuery = buildQuery({
      data: [
        {
          session_id: 'voice-1',
          room: 'canvas-room-1',
          trace_id: 'trace-2',
          request_id: 'req-2',
          intent_id: 'intent-2',
          created_at: '2026-03-11T10:02:00.000Z',
          event_type: 'session_close',
          status: 'participant_disconnected',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: 'provider-2',
          context_priming: null,
          metadata: null,
          output_payload: { reason: 'participant_disconnected', code: 4100 },
          error: null,
        },
        {
          session_id: 'voice-1',
          room: 'canvas-room-1',
          trace_id: 'trace-1',
          request_id: 'req-1',
          intent_id: 'intent-1',
          created_at: '2026-03-11T10:01:00.000Z',
          event_type: 'conversation_item_added',
          status: 'assistant',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: 'provider-1',
          context_priming: null,
          metadata: null,
          output_payload: { text: 'hello' },
          error: null,
        },
        {
          session_id: 'voice-1',
          room: 'canvas-room-1',
          trace_id: null,
          request_id: null,
          intent_id: null,
          created_at: '2026-03-11T10:00:00.000Z',
          event_type: 'session_started',
          status: 'running',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: null,
          context_priming: null,
          metadata: {
            workerId: 'worker-1',
            participantIdentity: 'voice-agent-1',
            modelControl: {
              configVersion: 'cfg-1',
              fieldSource: {
                scope: 'global',
                scopeId: 'global',
                profileId: 'profile-1',
              },
            },
          },
          output_payload: null,
          error: null,
        },
      ],
      error: null,
    });
    const toolEventsQuery = buildQuery({
      data: [
        {
          session_id: 'voice-1',
          trace_id: 'trace-3',
          request_id: 'req-3',
          intent_id: 'intent-3',
          created_at: '2026-03-11T10:01:30.000Z',
          event_type: 'tool_call_completed',
          status: 'succeeded',
          tool_name: 'dispatch_to_conductor',
          tool_call_id: 'call-1',
          provider_request_id: 'provider-3',
        },
      ],
      error: null,
    });

    let modelCallCount = 0;
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_model_io') {
          modelCallCount += 1;
          return modelCallCount === 1 ? startedQuery.query : modelEventsQuery.query;
        }
        if (table === 'agent_tool_io') {
          return toolEventsQuery.query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/voice-sessions?room=canvas-room-1&limit=10'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.available).toBe(true);
    expect(json.toolIoAvailable).toBe(true);
    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0]).toMatchObject({
      session_id: 'voice-1',
      room: 'canvas-room-1',
      status: 'closed',
      model: 'gpt-realtime-1.5',
      provider: 'openai',
      provider_request_id: 'provider-2',
      trace_id: 'trace-2',
      request_id: 'req-2',
      intent_id: 'intent-2',
      tool_call_count: 1,
      tool_event_count: 1,
      event_count: 3,
      last_tool_name: 'dispatch_to_conductor',
      config_version: 'cfg-1',
      control_scope: 'global',
      control_scope_id: 'global',
      control_profile_id: 'profile-1',
      worker_id: 'worker-1',
      participant_identity: 'voice-agent-1',
      close_reason: 'participant_disconnected',
      close_code: 4100,
    });
    expect(startedQuery.getLimit()).toBe(10);
    expect(startedQuery.getFilters()).toEqual([
      { column: 'source', value: 'voice_agent' },
      { column: 'event_type', value: 'session_started' },
      { column: 'room', value: 'canvas-room-1' },
    ]);
    expect(modelEventsQuery.getInFilters()).toEqual([{ column: 'session_id', values: ['voice-1'] }]);
    expect(toolEventsQuery.getInFilters()).toEqual([{ column: 'session_id', values: ['voice-1'] }]);
  });

  it('returns unavailable when the model replay ledger relation is missing', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-2' });
    const startedQuery = buildQuery({
      data: [],
      error: { message: 'relation "public.agent_model_io" does not exist', code: '42P01' },
    });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => startedQuery.query),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/voice-sessions'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.available).toBe(false);
    expect(json.toolIoAvailable).toBe(false);
    expect(json.sessions).toEqual([]);
  });

  it('keeps voice sessions available when tool replay is missing', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-3' });
    const startedQuery = buildQuery({
      data: [
        {
          session_id: 'voice-2',
          room: 'canvas-room-2',
          trace_id: null,
          request_id: null,
          intent_id: null,
          created_at: '2026-03-11T11:00:00.000Z',
          event_type: 'session_started',
          status: 'running',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: null,
          context_priming: null,
          metadata: null,
          output_payload: null,
          error: null,
        },
      ],
      error: null,
    });
    const modelEventsQuery = buildQuery({
      data: [
        {
          session_id: 'voice-2',
          room: 'canvas-room-2',
          trace_id: null,
          request_id: null,
          intent_id: null,
          created_at: '2026-03-11T11:00:00.000Z',
          event_type: 'session_started',
          status: 'running',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: null,
          context_priming: null,
          metadata: null,
          output_payload: null,
          error: null,
        },
      ],
      error: null,
    });
    const toolEventsQuery = buildQuery({
      data: [],
      error: { message: 'relation "public.agent_tool_io" does not exist', code: '42P01' },
    });

    let modelCallCount = 0;
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_model_io') {
          modelCallCount += 1;
          return modelCallCount === 1 ? startedQuery.query : modelEventsQuery.query;
        }
        if (table === 'agent_tool_io') {
          return toolEventsQuery.query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/voice-sessions'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.available).toBe(true);
    expect(json.toolIoAvailable).toBe(false);
    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0]).toMatchObject({
      session_id: 'voice-2',
      status: 'running',
      tool_call_count: 0,
      tool_event_count: 0,
    });
  });

  it('honors provider, path, and trace filters for voice sessions', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-4' });
    const traceModelQuery = buildQuery({
      data: [{ session_id: 'voice-2' }],
      error: null,
    });
    const startedQuery = buildQuery({
      data: [
        {
          session_id: 'voice-2',
          room: 'canvas-room-1',
          trace_id: null,
          request_id: null,
          intent_id: null,
          created_at: '2026-03-11T11:00:00.000Z',
          event_type: 'session_started',
          status: 'running',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: null,
          context_priming: null,
          metadata: null,
          output_payload: null,
          error: null,
        },
      ],
      error: null,
    });
    const modelEventsQuery = buildQuery({
      data: [
        {
          session_id: 'voice-2',
          room: 'canvas-room-1',
          trace_id: 'trace-match',
          request_id: 'req-match',
          intent_id: 'intent-match',
          created_at: '2026-03-11T11:00:10.000Z',
          event_type: 'conversation_item_added',
          status: 'assistant',
          provider: 'openai',
          model: 'gpt-realtime-1.5',
          provider_source: 'runtime_selected',
          provider_path: 'primary',
          provider_request_id: 'provider-match',
          context_priming: null,
          metadata: null,
          output_payload: null,
          error: null,
        },
      ],
      error: null,
    });
    const traceToolLookupQuery = buildQuery({ data: [], error: null });
    const toolEventsQuery = buildQuery({ data: [], error: null });

    let modelCallCount = 0;
    let toolCallCount = 0;
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_model_io') {
          modelCallCount += 1;
          if (modelCallCount === 1) return traceModelQuery.query;
          if (modelCallCount === 2) return startedQuery.query;
          return modelEventsQuery.query;
        }
        if (table === 'agent_tool_io') {
          toolCallCount += 1;
          return toolCallCount === 1 ? traceToolLookupQuery.query : toolEventsQuery.query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL(
        'http://localhost/api/admin/agents/voice-sessions?provider=openai&providerPath=primary&traceId=trace-match&limit=1',
      ),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0]).toMatchObject({
      session_id: 'voice-2',
      trace_id: 'trace-match',
    });
    expect(traceModelQuery.getLimit()).toBe(200);
    expect(traceModelQuery.getFilters()).toEqual([
      { column: 'source', value: 'voice_agent' },
      { column: 'trace_id', value: 'trace-match' },
    ]);
    expect(startedQuery.getLimit()).toBeNull();
    expect(startedQuery.getFilters()).toEqual([
      { column: 'source', value: 'voice_agent' },
      { column: 'event_type', value: 'session_started' },
      { column: 'provider', value: 'openai' },
      { column: 'provider_path', value: 'primary' },
    ]);
    expect(startedQuery.getInFilters()).toEqual([{ column: 'session_id', values: ['voice-2'] }]);
  });
});

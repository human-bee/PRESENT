import {
  classifyTraceSubsystem,
  deriveTraceFailureSummary,
  extractFailureReason,
  extractProviderIdentity,
  extractWorkerIdentity,
} from './trace-diagnostics';

describe('trace-diagnostics', () => {
  afterEach(() => {
    delete process.env.AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_OPENAI;
  });

  it('maps known stages to subsystems', () => {
    expect(classifyTraceSubsystem('api_received')).toBe('api');
    expect(classifyTraceSubsystem('queued')).toBe('queue');
    expect(classifyTraceSubsystem('executing')).toBe('worker');
    expect(classifyTraceSubsystem('routed')).toBe('router');
    expect(classifyTraceSubsystem('ack_received')).toBe('client-ack');
    expect(classifyTraceSubsystem('something-else')).toBe('unknown');
  });

  it('extracts worker identity from payload', () => {
    const worker = extractWorkerIdentity({
      workerId: 'worker-1',
      workerHost: 'host-a',
      workerPid: '1234',
    });
    expect(worker).toEqual({
      workerId: 'worker-1',
      workerHost: 'host-a',
      workerPid: '1234',
    });
  });

  it('extracts failure reason from nested payload fields', () => {
    expect(extractFailureReason({ error: { message: 'boom' } })).toBe('boom');
    expect(extractFailureReason({ reason: 'queue timeout' })).toBe('queue timeout');
    expect(extractFailureReason(null, 'fallback failure')).toBe('fallback failure');
  });

  it('extracts provider identity and link context', () => {
    process.env.AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_OPENAI =
      'https://platform.openai.com/logs?trace={traceId}&req={providerRequestId}';
    const provider = extractProviderIdentity({
      trace_id: 'trace-1',
      request_id: 'req-1',
      provider: 'openai',
      model: 'gpt-5-mini',
      provider_source: 'explicit',
      provider_path: 'primary',
      provider_request_id: 'provider-req-1',
      payload: null,
    });
    expect(provider).toMatchObject({
      provider: 'openai',
      model: 'gpt-5-mini',
      providerSource: 'explicit',
      providerPath: 'primary',
      providerRequestId: 'provider-req-1',
    });
    expect(provider.providerContextUrl).toContain('trace=trace-1');
  });

  it('derives failure summary from failed events and falls back to task status', () => {
    const summary = deriveTraceFailureSummary([
      {
        trace_id: 'trace-1',
        task_id: 'task-1',
        stage: 'executing',
        status: 'running',
        created_at: '2026-02-17T12:00:01.000Z',
        payload: { workerId: 'worker-1' },
      },
      {
        trace_id: 'trace-1',
        task_id: 'task-1',
        stage: 'failed',
        status: 'failed',
        created_at: '2026-02-17T12:00:02.000Z',
        payload: { error: 'tool crashed', workerId: 'worker-1' },
      },
    ]);
    expect(summary).toMatchObject({
      status: 'failed',
      stage: 'failed',
      subsystem: 'worker',
      reason: 'tool crashed',
      task_id: 'task-1',
      worker_id: 'worker-1',
      provider: 'unknown',
      provider_path: 'unknown',
    });

    const fallbackSummary = deriveTraceFailureSummary([], {
      status: 'failed',
      error: 'fallback failure',
      task_id: 'task-2',
      params: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
    });
    expect(fallbackSummary).toMatchObject({
      status: 'failed',
      stage: 'task_status_fallback',
      reason: 'fallback failure',
      task_id: 'task-2',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });
  });
});

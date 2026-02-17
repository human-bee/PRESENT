import {
  classifyTraceSubsystem,
  deriveTraceFailureSummary,
  extractFailureReason,
  extractWorkerIdentity,
} from './trace-diagnostics';

describe('trace-diagnostics', () => {
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
    });

    const fallbackSummary = deriveTraceFailureSummary([], {
      status: 'failed',
      error: 'fallback failure',
      task_id: 'task-2',
    });
    expect(fallbackSummary).toMatchObject({
      status: 'failed',
      stage: 'task_status_fallback',
      reason: 'fallback failure',
      task_id: 'task-2',
    });
  });
});

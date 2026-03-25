import path from 'node:path';
import { openWorkspaceSession, recordKernelEvent, resetKernelStateForTests } from '@present/kernel';
import { listTraceEvents, searchTraceEvents } from './traces';

describe('trace ledger filters', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-traces-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('supports workspace, cursor, order, and query filtering without rescanning in callers', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-traces-${Date.now()}`,
      title: 'Trace Filters',
      branch: 'codex/reset',
    });
    const earlier = '2026-03-24T10:00:00.000Z';
    const later = '2026-03-24T10:00:05.000Z';

    recordKernelEvent({
      id: 'evt_early',
      type: 'approval.requested',
      traceId: 'trace_123',
      workspaceSessionId: workspace.id,
      emittedAt: earlier,
      approvalRequestId: 'approval_early',
      state: 'pending',
      summary: 'start queued',
      metadata: { phase: 'queued' },
    });
    recordKernelEvent({
      id: 'evt_late',
      type: 'approval.requested',
      traceId: 'trace_123',
      workspaceSessionId: workspace.id,
      emittedAt: later,
      approvalRequestId: 'approval_late',
      state: 'pending',
      summary: 'needs approval',
      metadata: { phase: 'approval' },
    });
    recordKernelEvent({
      id: 'evt_other_workspace',
      type: 'approval.requested',
      traceId: 'trace_other',
      workspaceSessionId: 'ws_other',
      emittedAt: '2026-03-24T10:00:06.000Z',
      approvalRequestId: 'approval_other',
      state: 'pending',
      summary: 'other workspace',
      metadata: {},
    });

    expect(
      listTraceEvents({
        workspaceSessionId: workspace.id,
      }).map((event) => event.id),
    ).toEqual(['evt_late', 'evt_early']);

    expect(
      listTraceEvents({
        traceId: 'trace_123',
        emittedAfterOrAt: later,
        order: 'asc',
      }).map((event) => event.id),
    ).toEqual(['evt_late']);

    expect(
      searchTraceEvents('approval', {
        workspaceSessionId: workspace.id,
        limit: 1,
      }).map((event) => event.id),
    ).toEqual(['evt_late']);
  });
});

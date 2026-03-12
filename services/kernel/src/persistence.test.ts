import path from 'node:path';
import type { KernelEvent, WorkspaceSession } from '@present/contracts';

type SupabaseRow = Record<string, unknown>;

const supabaseTables: Record<string, SupabaseRow[]> = {};

const resetSupabaseTables = () => {
  Object.keys(supabaseTables).forEach((key) => {
    delete supabaseTables[key];
  });
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from(table: string) {
      return {
        async select(columns = '*') {
          const data = [...(supabaseTables[table] ?? [])];
          if (columns === 'id') {
            return { data: data.map((row) => ({ id: row.id })), error: null };
          }
          return { data, error: null };
        },
        async upsert(rows: SupabaseRow[]) {
          const existing = [...(supabaseTables[table] ?? [])];
          for (const row of rows) {
            const rowId = String(row.id);
            const index = existing.findIndex((entry) => String(entry.id) === rowId);
            if (index >= 0) {
              existing[index] = { ...existing[index], ...row };
            } else {
              existing.push({ ...row });
            }
          }
          supabaseTables[table] = existing;
          return { data: rows, error: null };
        },
        delete() {
          return {
            async in(_column: string, ids: string[]) {
              supabaseTables[table] = (supabaseTables[table] ?? []).filter((row) => !ids.includes(String(row.id)));
              return { data: null, error: null };
            },
          };
        },
      };
    },
  })),
}));

import {
  ensureResetKernelHydrated,
  flushResetPersistenceMirrors,
  getResetKernelStatePath,
  readResetCollection,
  resetKernelStateForTests,
  writeResetCollection,
} from './persistence';

describe('reset persistence', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-persistence-${Date.now()}-${Math.random()}.json`,
    );
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    resetSupabaseTables();
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    resetSupabaseTables();
    delete process.env.PRESENT_RESET_STATE_PATH;
    delete process.env.PRESENT_RESET_SUPABASE_CACHE_TTL_MS;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('hydrates reset collections from Supabase when configured', async () => {
    const workspace: WorkspaceSession = {
      id: 'ws_supabase',
      workspacePath: '/tmp/present-from-supabase',
      branch: 'codex/reset',
      title: 'Hydrated Workspace',
      state: 'active',
      ownerUserId: null,
      activeExecutorSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { source: 'supabase' },
    };
    const event: KernelEvent = {
      id: 'event_supabase',
      type: 'turn.started',
      traceId: 'trace_supabase',
      workspaceSessionId: workspace.id,
      taskRunId: 'task_supabase',
      title: 'Hydrated turn',
      detail: null,
      metadata: { source: 'supabase' },
      emittedAt: new Date().toISOString(),
    };

    supabaseTables.workspace_sessions = [
      {
        id: workspace.id,
        workspace_path: workspace.workspacePath,
        branch: workspace.branch,
        title: workspace.title,
        state: workspace.state,
        owner_user_id: workspace.ownerUserId,
        active_executor_session_id: workspace.activeExecutorSessionId,
        metadata: workspace.metadata,
        created_at: workspace.createdAt,
        updated_at: workspace.updatedAt,
      },
    ];
    supabaseTables.reset_trace_events = [
      {
        id: event.id,
        trace_id: event.traceId,
        workspace_session_id: event.workspaceSessionId,
        event_type: event.type,
        payload: {
          taskRunId: event.taskRunId,
          title: event.title,
          detail: event.detail,
          metadata: event.metadata,
        },
        emitted_at: event.emittedAt,
      },
    ];

    await ensureResetKernelHydrated();

    expect(readResetCollection('workspaces')).toEqual([workspace]);
    expect(readResetCollection('traces')).toEqual([event]);
    expect(getResetKernelStatePath()).toContain('present-reset-state-persistence');
  });

  it('flushes mirrored writes back to Supabase tables', async () => {
    const initialWorkspace: WorkspaceSession = {
      id: 'ws_existing',
      workspacePath: '/tmp/existing',
      branch: 'codex/reset',
      title: 'Existing',
      state: 'active',
      ownerUserId: null,
      activeExecutorSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    supabaseTables.workspace_sessions = [
      {
        id: initialWorkspace.id,
        workspace_path: initialWorkspace.workspacePath,
        branch: initialWorkspace.branch,
        title: initialWorkspace.title,
        state: initialWorkspace.state,
        owner_user_id: null,
        active_executor_session_id: null,
        metadata: {},
        created_at: initialWorkspace.createdAt,
        updated_at: initialWorkspace.updatedAt,
      },
    ];

    await ensureResetKernelHydrated();

    const nextWorkspace: WorkspaceSession = {
      ...initialWorkspace,
      id: 'ws_next',
      workspacePath: '/tmp/next',
      title: 'Next',
      updatedAt: new Date().toISOString(),
    };

    writeResetCollection('workspaces', [nextWorkspace]);
    await flushResetPersistenceMirrors();

    expect(supabaseTables.workspace_sessions).toEqual([
      expect.objectContaining({
        id: 'ws_next',
        workspace_path: '/tmp/next',
        title: 'Next',
      }),
    ]);
  });

  it('refreshes from Supabase again after the cache ttl expires', async () => {
    process.env.PRESENT_RESET_SUPABASE_CACHE_TTL_MS = '0';

    supabaseTables.workspace_sessions = [
      {
        id: 'ws_old',
        workspace_path: '/tmp/old',
        branch: 'codex/reset',
        title: 'Old',
        state: 'active',
        owner_user_id: null,
        active_executor_session_id: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    await ensureResetKernelHydrated();
    expect(readResetCollection('workspaces').map((workspace) => workspace.id)).toEqual(['ws_old']);

    supabaseTables.workspace_sessions = [
      {
        id: 'ws_new',
        workspace_path: '/tmp/new',
        branch: 'codex/reset',
        title: 'New',
        state: 'active',
        owner_user_id: null,
        active_executor_session_id: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    await ensureResetKernelHydrated();
    expect(readResetCollection('workspaces').map((workspace) => workspace.id)).toEqual(['ws_new']);
  });
});

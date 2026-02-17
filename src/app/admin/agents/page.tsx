'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentOpsOverview } from '@/components/admin/agent-ops-overview';
import { AgentQueueTable } from '@/components/admin/agent-queue-table';
import { AgentTraceTimeline } from '@/components/admin/agent-trace-timeline';
import { AgentWorkerHealth } from '@/components/admin/agent-worker-health';
import { AgentSafeActions } from '@/components/admin/agent-safe-actions';
import { AgentAuditLog } from '@/components/admin/agent-audit-log';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import type {
  AgentAuditEntry,
  AgentOverviewResponse,
  AgentQueueTask,
  AgentTraceEventRow,
  AgentWorkerHeartbeat,
} from '@/components/admin/types';

async function readJson<T>(url: string): Promise<T> {
  const res = await fetchWithSupabaseAuth(url, { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const withQuery = (path: string, params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

export default function AgentAdminPage() {
  const [overview, setOverview] = useState<AgentOverviewResponse | null>(null);
  const [tasks, setTasks] = useState<AgentQueueTask[]>([]);
  const [traces, setTraces] = useState<AgentTraceEventRow[]>([]);
  const [workers, setWorkers] = useState<AgentWorkerHeartbeat[]>([]);
  const [auditEntries, setAuditEntries] = useState<AgentAuditEntry[]>([]);
  const [selectedTask, setSelectedTask] = useState<AgentQueueTask | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedTraceEvents, setSelectedTraceEvents] = useState<AgentTraceEventRow[]>([]);
  const [selectedTraceLoading, setSelectedTraceLoading] = useState(false);
  const [selectedTraceError, setSelectedTraceError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<'allowlist' | 'open_access' | null>(null);
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [safeActionsAllowed, setSafeActionsAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [roomFilterDraft, setRoomFilterDraft] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [traceFilterDraft, setTraceFilterDraft] = useState('');
  const selectedTraceIdRef = useRef<string | null>(null);
  const traceLoadRequestSeqRef = useRef(0);

  const loadTrace = useCallback(async (traceId: string) => {
    const normalizedTraceId = traceId.trim();
    if (!normalizedTraceId) {
      traceLoadRequestSeqRef.current += 1;
      selectedTraceIdRef.current = null;
      setSelectedTraceId(null);
      setSelectedTraceEvents([]);
      setSelectedTraceError(null);
      return;
    }
    const requestSeq = traceLoadRequestSeqRef.current + 1;
    traceLoadRequestSeqRef.current = requestSeq;
    selectedTraceIdRef.current = normalizedTraceId;
    setSelectedTraceId(normalizedTraceId);
    setSelectedTraceLoading(true);
    setSelectedTraceError(null);
    try {
      const traceRes = await readJson<{ events?: AgentTraceEventRow[] }>(
        `/api/traces/${encodeURIComponent(normalizedTraceId)}`,
      );
      if (
        requestSeq !== traceLoadRequestSeqRef.current ||
        selectedTraceIdRef.current !== normalizedTraceId
      ) {
        return;
      }
      setSelectedTraceEvents(Array.isArray(traceRes.events) ? traceRes.events : []);
    } catch (e) {
      if (
        requestSeq !== traceLoadRequestSeqRef.current ||
        selectedTraceIdRef.current !== normalizedTraceId
      ) {
        return;
      }
      const message = e instanceof Error ? e.message : 'Failed to load trace';
      setSelectedTraceError(message);
      setSelectedTraceEvents([]);
    } finally {
      if (requestSeq === traceLoadRequestSeqRef.current) {
        setSelectedTraceLoading(false);
      }
    }
  }, []);

  const clearTraceSelection = useCallback(() => {
    traceLoadRequestSeqRef.current += 1;
    selectedTraceIdRef.current = null;
    setSelectedTraceId(null);
    setSelectedTraceEvents([]);
    setSelectedTraceError(null);
    setSelectedTraceLoading(false);
    setTraceFilterDraft('');
  }, []);

  const refresh = useCallback(async () => {
    const normalizedRoomFilter = roomFilter.trim() || undefined;
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, queueRes, tracesRes, workersRes, auditRes] = await Promise.all([
        readJson<AgentOverviewResponse>('/api/admin/agents/overview'),
        readJson<{ tasks: AgentQueueTask[] }>(
          withQuery('/api/admin/agents/queue', {
            limit: 200,
            room: normalizedRoomFilter,
          }),
        ),
        readJson<{ traces: AgentTraceEventRow[] }>(
          withQuery('/api/admin/agents/traces', {
            limit: 200,
            room: normalizedRoomFilter,
          }),
        ),
        readJson<{ workers: AgentWorkerHeartbeat[] }>('/api/admin/agents/workers'),
        readJson<{ entries: AgentAuditEntry[] }>('/api/admin/agents/audit?limit=120'),
      ]);
      setOverview(overviewRes);
      setAccessMode(overviewRes.actorAccessMode ?? 'allowlist');
      setActorUserId(typeof overviewRes.actorUserId === 'string' ? overviewRes.actorUserId : null);
      setSafeActionsAllowed(overviewRes.safeActionsAllowed !== false);
      setTasks(Array.isArray(queueRes.tasks) ? queueRes.tasks : []);
      setTraces(Array.isArray(tracesRes.traces) ? tracesRes.traces : []);
      setWorkers(Array.isArray(workersRes.workers) ? workersRes.workers : []);
      setAuditEntries(Array.isArray(auditRes.entries) ? auditRes.entries : []);
      setPollingEnabled(true);
      if (selectedTraceIdRef.current) {
        void loadTrace(selectedTraceIdRef.current);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load admin data';
      setAccessMode(null);
      setActorUserId(null);
      setSafeActionsAllowed(false);
      if (message.includes('admin_allowlist_not_configured')) {
        setError('Admin allowlist is not configured. Set AGENT_ADMIN_ALLOWLIST_USER_IDS to access this page.');
        setPollingEnabled(false);
      } else if (message.includes('forbidden')) {
        setError('Your account is not allowlisted for admin agent access.');
        setPollingEnabled(false);
      } else if (message.includes('unauthorized')) {
        setError('Please sign in to access admin agent observability.');
        setPollingEnabled(false);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [loadTrace, roomFilter]);

  useEffect(() => {
    void refresh();
    if (!pollingEnabled) {
      return;
    }
    const handle = window.setInterval(() => {
      void refresh();
    }, 8_000);
    return () => {
      window.clearInterval(handle);
    };
  }, [pollingEnabled, refresh]);

  return (
    <main
      data-theme="light"
      className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Agent Observability Admin</h1>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Swarm orchestration traces, queue state, worker health, and safe actions.
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Filter by room for per-canvas diagnostics (example: <span className="font-mono">canvas-1234...</span>).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setRoomFilter(roomFilterDraft.trim());
              }}
            >
              <input
                type="text"
                value={roomFilterDraft}
                onChange={(event) => setRoomFilterDraft(event.target.value)}
                placeholder="Filter room (canvas-...)"
                className="w-64 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
                disabled={loading}
              >
                Apply
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                disabled={loading || (!roomFilter && !roomFilterDraft)}
                onClick={() => {
                  setRoomFilterDraft('');
                  setRoomFilter('');
                  clearTraceSelection();
                }}
              >
                Clear
              </button>
            </form>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const normalizedTraceId = traceFilterDraft.trim();
                if (!normalizedTraceId) return;
                void loadTrace(normalizedTraceId);
              }}
            >
              <input
                type="text"
                value={traceFilterDraft}
                onChange={(event) => setTraceFilterDraft(event.target.value)}
                placeholder="Trace id"
                className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                disabled={loading || traceFilterDraft.trim().length === 0}
              >
                Open Trace
              </button>
            </form>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {accessMode === 'open_access' && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">
            {actorUserId === 'anonymous'
              ? 'Public read access is active. Anyone can view observability data; safe actions still require allowlist membership.'
              : 'Authenticated open access is active. Read views are open to signed-in users; safe actions still require allowlist membership.'}
          </div>
        )}

        {error && (
          <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        )}

        {roomFilter && (
          <div className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/60 dark:bg-sky-500/10 dark:text-sky-100">
            Active room filter: <span className="font-mono">{roomFilter}</span>
          </div>
        )}

        <AgentOpsOverview overview={overview} />

        <div className="grid gap-4 xl:grid-cols-2">
          <AgentQueueTable
            tasks={tasks}
            onSelectTask={(task) => {
              setSelectedTask(task);
              if (task.trace_id) {
                setTraceFilterDraft(task.trace_id);
                void loadTrace(task.trace_id);
              }
            }}
          />
          <AgentTraceTimeline
            traces={traces}
            selectedTraceId={selectedTraceId}
            onSelectTraceId={(traceId) => {
              setTraceFilterDraft(traceId);
              void loadTrace(traceId);
            }}
          />
        </div>

        {selectedTraceId && (
          <section className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Trace Detail <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{selectedTraceId}</span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadTrace(selectedTraceId)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  {selectedTraceLoading ? 'Loading…' : 'Reload'}
                </button>
                <button
                  type="button"
                  onClick={clearTraceSelection}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
            {selectedTraceError && (
              <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                {selectedTraceError}
              </p>
            )}
            <ol className="mt-3 max-h-[280px] space-y-2 overflow-auto text-sm">
              {selectedTraceEvents.map((event) => (
                <li
                  key={event.id}
                  className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {event.stage}
                      {event.status ? ` · ${event.status}` : ''}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      {event.created_at ? new Date(event.created_at).toLocaleTimeString() : 'n/a'}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-700 dark:text-slate-300">
                    {(event.task || 'unknown-task')}{event.room ? ` · ${event.room}` : ''}
                  </div>
                  {(event.request_id || event.intent_id || event.task_id) && (
                    <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {event.request_id ? `request:${event.request_id} ` : ''}
                      {event.intent_id ? `intent:${event.intent_id} ` : ''}
                      {event.task_id ? `task:${event.task_id}` : ''}
                    </div>
                  )}
                </li>
              ))}
              {!selectedTraceLoading && selectedTraceEvents.length === 0 && !selectedTraceError && (
                <li className="text-slate-600 dark:text-slate-300">No events found for this trace.</li>
              )}
            </ol>
          </section>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <AgentWorkerHealth workers={workers} />
          <AgentSafeActions selectedTask={selectedTask} onApplied={refresh} actionsAllowed={safeActionsAllowed} />
        </div>

        <AgentAuditLog entries={auditEntries} />
      </div>
    </main>
  );
}

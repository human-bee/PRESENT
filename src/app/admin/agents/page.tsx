'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentOpsOverview } from '@/components/admin/agent-ops-overview';
import { AgentQueueTable } from '@/components/admin/agent-queue-table';
import { AgentTraceTimeline } from '@/components/admin/agent-trace-timeline';
import { AgentWorkerHealth } from '@/components/admin/agent-worker-health';
import { AgentSafeActions } from '@/components/admin/agent-safe-actions';
import { AgentAuditLog } from '@/components/admin/agent-audit-log';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { formatJsonForDisplay, type JsonDisplayMode } from '@/lib/agents/admin/json-display';
import type {
  AgentAuditEntry,
  AgentOverviewResponse,
  AgentQueueTask,
  AgentTraceContextResponse,
  AgentTraceEventRow,
  AgentTraceFailure,
  AgentTraceTaskSnapshot,
  AgentTraceContextTranscriptEntry,
  AgentWorkerHeartbeat,
} from '@/components/admin/types';

const LIST_POLL_MS = 15_000;
const TRACE_CONTEXT_PAGE_LIMIT = 200;

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

const mergeTranscriptEntries = (
  current: AgentTraceContextTranscriptEntry[],
  incoming: AgentTraceContextTranscriptEntry[],
  mode: 'replace' | 'prepend' | 'append',
): AgentTraceContextTranscriptEntry[] => {
  const source =
    mode === 'replace'
      ? incoming
      : mode === 'prepend'
        ? [...incoming, ...current]
        : [...current, ...incoming];
  const unique = new Map<string, AgentTraceContextTranscriptEntry>();
  for (const entry of source) {
    unique.set(entry.eventId, entry);
  }
  return Array.from(unique.values()).sort((left, right) => left.timestamp - right.timestamp);
};

const summarizeTranscript = (entries: AgentTraceContextTranscriptEntry[]): string =>
  entries.map((entry) => `[${new Date(entry.timestamp).toISOString()}] ${entry.participantName || entry.participantId}: ${entry.text}`).join('\n');

const getErrorText = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const parseErrorCode = (message: string): string => {
  const normalized = message.toLowerCase();
  if (normalized.includes('unauthorized')) return 'unauthorized';
  if (normalized.includes('forbidden')) return 'forbidden';
  if (normalized.includes('admin_allowlist_not_configured')) return 'allowlist';
  return 'other';
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
  const [selectedTraceContext, setSelectedTraceContext] = useState<AgentTraceContextResponse | null>(null);
  const [selectedTraceContextLoading, setSelectedTraceContextLoading] = useState(false);
  const [selectedTraceContextError, setSelectedTraceContextError] = useState<string | null>(null);
  const [transcriptEntries, setTranscriptEntries] = useState<AgentTraceContextTranscriptEntry[]>([]);
  const [transcriptHasOlder, setTranscriptHasOlder] = useState(false);
  const [transcriptHasNewer, setTranscriptHasNewer] = useState(false);
  const [transcriptBeforeTs, setTranscriptBeforeTs] = useState<number | null>(null);
  const [transcriptAfterTs, setTranscriptAfterTs] = useState<number | null>(null);
  const [transcriptPagingDirection, setTranscriptPagingDirection] = useState<'older' | 'newer' | null>(null);
  const [threadHistoryExpanded, setThreadHistoryExpanded] = useState(false);
  const [accessMode, setAccessMode] = useState<'allowlist' | 'open_access' | null>(null);
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [safeActionsAllowed, setSafeActionsAllowed] = useState(false);
  const [detailLocked, setDetailLocked] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [roomFilterDraft, setRoomFilterDraft] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [traceFilterDraft, setTraceFilterDraft] = useState('');
  const [jsonMode, setJsonMode] = useState<JsonDisplayMode>('pretty');
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [allowUnmaskedInSession, setAllowUnmaskedInSession] = useState(false);
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const selectedTraceIdRef = useRef<string | null>(null);
  const traceLoadRequestSeqRef = useRef(0);
  const traceContextRequestSeqRef = useRef(0);
  const copyStatusTimeoutRef = useRef<number | null>(null);
  const maskPreferenceInitializedRef = useRef(false);

  const applyTranscriptPage = useCallback(
    (
      contextResponse: AgentTraceContextResponse,
      mergeMode: 'replace' | 'prepend' | 'append',
    ) => {
      const page = contextResponse.transcriptPage;
      setTranscriptEntries((current) => mergeTranscriptEntries(current, page.entries, mergeMode));
      setTranscriptHasOlder(page.hasOlder);
      setTranscriptHasNewer(page.hasNewer);
      setTranscriptBeforeTs(page.nextBeforeTs);
      setTranscriptAfterTs(page.nextAfterTs);
    },
    [],
  );

  const loadTraceEvents = useCallback(async (traceId: string) => {
    const normalizedTraceId = traceId.trim();
    if (!normalizedTraceId) {
      setSelectedTraceEvents([]);
      setSelectedTraceError(null);
      return;
    }
    const requestSeq = traceLoadRequestSeqRef.current + 1;
    traceLoadRequestSeqRef.current = requestSeq;
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
    } catch (eventLoadError) {
      if (
        requestSeq !== traceLoadRequestSeqRef.current ||
        selectedTraceIdRef.current !== normalizedTraceId
      ) {
        return;
      }
      setSelectedTraceError(getErrorText(eventLoadError, 'Failed to load trace'));
      setSelectedTraceEvents([]);
    } finally {
      if (requestSeq === traceLoadRequestSeqRef.current) {
        setSelectedTraceLoading(false);
      }
    }
  }, []);

  const loadTraceContext = useCallback(
    async (
      traceId: string,
      options?: {
        direction?: 'latest' | 'older' | 'newer';
        beforeTs?: number | null;
        afterTs?: number | null;
        mergeMode?: 'replace' | 'prepend' | 'append';
      },
    ) => {
      const normalizedTraceId = traceId.trim();
      if (!normalizedTraceId) {
        setSelectedTraceContext(null);
        setSelectedTraceContextError(null);
        setTranscriptEntries([]);
        setTranscriptHasOlder(false);
        setTranscriptHasNewer(false);
        setTranscriptBeforeTs(null);
        setTranscriptAfterTs(null);
        return;
      }

      const direction = options?.direction ?? 'latest';
      const mergeMode = options?.mergeMode ?? 'replace';
      const requestSeq = traceContextRequestSeqRef.current + 1;
      traceContextRequestSeqRef.current = requestSeq;
      if (mergeMode === 'replace') {
        setSelectedTraceContextLoading(true);
      } else {
        setTranscriptPagingDirection(direction === 'latest' ? null : direction);
      }
      setSelectedTraceContextError(null);

      const url = withQuery(
        `/api/admin/agents/traces/${encodeURIComponent(normalizedTraceId)}/context`,
        {
          limit: TRACE_CONTEXT_PAGE_LIMIT,
          direction,
          beforeTs: options?.beforeTs ?? undefined,
          afterTs: options?.afterTs ?? undefined,
        },
      );
      try {
        const context = await readJson<AgentTraceContextResponse>(url);
        if (
          requestSeq !== traceContextRequestSeqRef.current ||
          selectedTraceIdRef.current !== normalizedTraceId
        ) {
          return;
        }
        setSelectedTraceContext(context);
        applyTranscriptPage(context, mergeMode);
      } catch (contextLoadError) {
        if (
          requestSeq !== traceContextRequestSeqRef.current ||
          selectedTraceIdRef.current !== normalizedTraceId
        ) {
          return;
        }
        setSelectedTraceContextError(getErrorText(contextLoadError, 'Failed to load trace context'));
        if (mergeMode === 'replace') {
          setSelectedTraceContext(null);
          setTranscriptEntries([]);
          setTranscriptHasOlder(false);
          setTranscriptHasNewer(false);
          setTranscriptBeforeTs(null);
          setTranscriptAfterTs(null);
        }
      } finally {
        if (requestSeq === traceContextRequestSeqRef.current) {
          if (mergeMode === 'replace') {
            setSelectedTraceContextLoading(false);
          } else {
            setTranscriptPagingDirection(null);
          }
        }
      }
    },
    [applyTranscriptPage],
  );

  const clearTraceSelection = useCallback(() => {
    traceLoadRequestSeqRef.current += 1;
    traceContextRequestSeqRef.current += 1;
    selectedTraceIdRef.current = null;
    setSelectedTraceId(null);
    setSelectedTraceEvents([]);
    setSelectedTraceError(null);
    setSelectedTraceLoading(false);
    setSelectedTraceContext(null);
    setSelectedTraceContextLoading(false);
    setSelectedTraceContextError(null);
    setTranscriptEntries([]);
    setTranscriptHasOlder(false);
    setTranscriptHasNewer(false);
    setTranscriptBeforeTs(null);
    setTranscriptAfterTs(null);
    setThreadHistoryExpanded(false);
    setTranscriptPagingDirection(null);
    setTraceFilterDraft('');
    setExpandedPayloadIds({});
  }, []);

  const openTrace = useCallback(
    (traceId: string) => {
      const normalizedTraceId = traceId.trim();
      if (!normalizedTraceId) return;
      selectedTraceIdRef.current = normalizedTraceId;
      setSelectedTraceId(normalizedTraceId);
      setTraceFilterDraft(normalizedTraceId);
      setExpandedPayloadIds({});
      void loadTraceEvents(normalizedTraceId);
      void loadTraceContext(normalizedTraceId, { direction: 'latest', mergeMode: 'replace' });
    },
    [loadTraceContext, loadTraceEvents],
  );

  const refresh = useCallback(async () => {
    const normalizedRoomFilter = roomFilter.trim() || undefined;
    setLoading(true);
    setError(null);
    setDetailError(null);
    try {
      const overviewRes = await readJson<AgentOverviewResponse>('/api/admin/agents/overview');
      setOverview(overviewRes);
      setAccessMode(overviewRes.actorAccessMode ?? 'allowlist');
      setActorUserId(typeof overviewRes.actorUserId === 'string' ? overviewRes.actorUserId : null);
      setSafeActionsAllowed(overviewRes.safeActionsAllowed !== false);
      if (!maskPreferenceInitializedRef.current) {
        setMaskSensitive(overviewRes.detailMaskDefault !== false);
        maskPreferenceInitializedRef.current = true;
      }

      const canReadDetails = typeof overviewRes.actorUserId === 'string' && overviewRes.actorUserId !== 'anonymous';
      setDetailLocked(!canReadDetails);
      setPollingEnabled(true);

      if (!canReadDetails) {
        setTasks([]);
        setTraces([]);
        setWorkers([]);
        setAuditEntries([]);
        setSelectedTask(null);
        if (selectedTraceIdRef.current) {
          clearTraceSelection();
        }
        return;
      }

      try {
        const [queueRes, tracesRes, workersRes, auditRes] = await Promise.all([
          readJson<{ tasks: AgentQueueTask[] }>(
            withQuery('/api/admin/agents/queue', {
              limit: 100,
              room: normalizedRoomFilter,
            }),
          ),
          readJson<{ traces: AgentTraceEventRow[] }>(
            withQuery('/api/admin/agents/traces', {
              limit: 100,
              room: normalizedRoomFilter,
            }),
          ),
          readJson<{ workers: AgentWorkerHeartbeat[] }>('/api/admin/agents/workers'),
          readJson<{ entries: AgentAuditEntry[] }>('/api/admin/agents/audit?limit=120'),
        ]);
        setTasks(Array.isArray(queueRes.tasks) ? queueRes.tasks : []);
        setTraces(Array.isArray(tracesRes.traces) ? tracesRes.traces : []);
        setWorkers(Array.isArray(workersRes.workers) ? workersRes.workers : []);
        setAuditEntries(Array.isArray(auditRes.entries) ? auditRes.entries : []);
      } catch (detailLoadError) {
        const message = getErrorText(detailLoadError, 'Failed to load detailed admin data');
        const code = parseErrorCode(message);
        if (code === 'unauthorized') {
          setDetailLocked(true);
          setDetailError('Please sign in to access detailed observability panels.');
        } else if (code === 'forbidden') {
          setDetailError('Detailed observability access is denied for this account.');
        } else {
          setDetailError(message);
        }
        setTasks([]);
        setTraces([]);
        setWorkers([]);
        setAuditEntries([]);
      }
    } catch (overviewLoadError) {
      const message = getErrorText(overviewLoadError, 'Failed to load admin data');
      setAccessMode(null);
      setActorUserId(null);
      setSafeActionsAllowed(false);
      const code = parseErrorCode(message);
      if (code === 'allowlist') {
        setError('Admin allowlist is not configured. Set AGENT_ADMIN_ALLOWLIST_USER_IDS to access this page.');
        setPollingEnabled(false);
      } else if (code === 'forbidden') {
        setError('Your account is not allowlisted for admin agent access.');
        setPollingEnabled(false);
      } else if (code === 'unauthorized') {
        setError('Please sign in to access admin agent observability.');
        setPollingEnabled(false);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [clearTraceSelection, roomFilter]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollingEnabled || !isPageVisible) return;
    const handle = window.setInterval(() => {
      void refresh();
    }, LIST_POLL_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [isPageVisible, pollingEnabled, refresh]);

  useEffect(
    () => () => {
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current);
      }
    },
    [],
  );

  const selectedFailureSummary: AgentTraceFailure | null = useMemo(() => {
    if (selectedTraceContext?.failure) return selectedTraceContext.failure;
    const failed = selectedTraceEvents.find((event) => {
      const stage = event.stage.toLowerCase();
      const status = (event.status || '').toLowerCase();
      return stage === 'failed' || status === 'failed' || status === 'error';
    });
    if (!failed) return null;
    return {
      status: failed.status || 'failed',
      stage: failed.stage,
      subsystem: failed.subsystem || null,
      reason: failed.failure_reason || null,
      created_at: failed.created_at || null,
      trace_id: failed.trace_id || null,
      request_id: failed.request_id || null,
      intent_id: failed.intent_id || null,
      task_id: failed.task_id || null,
      task: failed.task || null,
      worker_id: failed.worker_id || null,
    };
  }, [selectedTraceContext, selectedTraceEvents]);

  const selectedTaskSnapshot: AgentTraceTaskSnapshot = selectedTraceContext?.taskSnapshot ?? null;

  const onMaskToggle = useCallback(
    (nextMaskEnabled: boolean) => {
      if (nextMaskEnabled) {
        setMaskSensitive(true);
        return;
      }
      if (!allowUnmaskedInSession) {
        const confirmed = window.confirm(
          'Show unmasked payload values for this browser session? This may expose sensitive data.',
        );
        if (!confirmed) return;
        setAllowUnmaskedInSession(true);
      }
      setMaskSensitive(false);
    },
    [allowUnmaskedInSession],
  );

  const copyToClipboard = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(successMessage);
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current);
      }
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus(null);
      }, 2_000);
    } catch {
      setCopyStatus('Copy failed');
    }
  }, []);

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
                openTrace(normalizedTraceId);
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
                disabled={loading || traceFilterDraft.trim().length === 0 || detailLocked}
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
              ? 'Public summary access is active. Sign in to access detailed traces, queue diagnostics, and transcript context.'
              : 'Authenticated open access is active. Signed-in users can read detailed observability; safe actions still require allowlist membership.'}
          </div>
        )}

        {detailLocked && !error && (
          <div className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/60 dark:bg-sky-500/10 dark:text-sky-100">
            Detailed observability panels are available only to signed-in users.
          </div>
        )}

        {error && (
          <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        )}

        {detailError && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100">
            {detailError}
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
                openTrace(task.trace_id);
              }
            }}
          />
          <AgentTraceTimeline
            traces={traces}
            selectedTraceId={selectedTraceId}
            onSelectTraceId={(traceId) => {
              openTrace(traceId);
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
                  onClick={() => {
                    if (!selectedTraceId) return;
                    void loadTraceEvents(selectedTraceId);
                    void loadTraceContext(selectedTraceId, { direction: 'latest', mergeMode: 'replace' });
                  }}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  {selectedTraceLoading || selectedTraceContextLoading ? 'Loading…' : 'Reload'}
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

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Payload View:</span>
              <button
                type="button"
                onClick={() => setJsonMode('pretty')}
                className={[
                  'rounded border px-2 py-1',
                  jsonMode === 'pretty'
                    ? 'border-sky-400 bg-sky-50 text-sky-900'
                    : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
                ].join(' ')}
              >
                Pretty JSON
              </button>
              <button
                type="button"
                onClick={() => setJsonMode('raw')}
                className={[
                  'rounded border px-2 py-1',
                  jsonMode === 'raw'
                    ? 'border-sky-400 bg-sky-50 text-sky-900'
                    : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
                ].join(' ')}
              >
                Raw JSON
              </button>
              <button
                type="button"
                onClick={() => onMaskToggle(!maskSensitive)}
                className={[
                  'rounded border px-2 py-1',
                  maskSensitive
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                    : 'border-amber-400 bg-amber-50 text-amber-900',
                ].join(' ')}
              >
                {maskSensitive ? 'Mask Sensitive: On' : 'Mask Sensitive: Off'}
              </button>
              <button
                type="button"
                onClick={() =>
                  void copyToClipboard(
                    formatJsonForDisplay(selectedTraceEvents, {
                      mode: jsonMode,
                      maskSensitive,
                    }),
                    'Trace JSON copied',
                  )
                }
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Copy Trace JSON
              </button>
              <button
                type="button"
                onClick={() =>
                  void copyToClipboard(
                    summarizeTranscript(transcriptEntries),
                    'Transcript excerpt copied',
                  )
                }
                disabled={transcriptEntries.length === 0}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Copy Transcript
              </button>
              {copyStatus && <span className="text-xs text-slate-600 dark:text-slate-300">{copyStatus}</span>}
            </div>

            {!maskSensitive && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">
                Sensitive masking is disabled for this browser session.
              </p>
            )}

            {selectedFailureSummary && (
              <div className="mt-3 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                <div className="font-semibold">
                  Failure: {selectedFailureSummary.reason || 'Unknown failure reason'}
                </div>
                <div className="mt-1">
                  Stage: <span className="font-mono">{selectedFailureSummary.stage || 'unknown'}</span> ·
                  Subsystem: <span className="font-mono">{selectedFailureSummary.subsystem || 'unknown'}</span> ·
                  Worker: <span className="font-mono">{selectedFailureSummary.worker_id || 'n/a'}</span>
                </div>
                <div className="mt-1 font-mono text-xs">
                  {selectedFailureSummary.created_at ? `at:${selectedFailureSummary.created_at} ` : ''}
                  {selectedFailureSummary.request_id ? `request:${selectedFailureSummary.request_id} ` : ''}
                  {selectedFailureSummary.intent_id ? `intent:${selectedFailureSummary.intent_id} ` : ''}
                  {selectedFailureSummary.task_id ? `task:${selectedFailureSummary.task_id}` : ''}
                </div>
              </div>
            )}

            {selectedTaskSnapshot && (
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Task snapshot: <span className="font-mono">{selectedTaskSnapshot.id}</span> ·
                status <span className="font-mono">{selectedTaskSnapshot.status || 'n/a'}</span> ·
                attempt <span className="font-mono">{selectedTaskSnapshot.attempt}</span>
              </div>
            )}

            {selectedTraceError && (
              <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                {selectedTraceError}
              </p>
            )}
            {selectedTraceContextError && (
              <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                {selectedTraceContextError}
              </p>
            )}

            <ol className="mt-3 max-h-[280px] space-y-2 overflow-auto text-sm">
              {selectedTraceEvents.map((event) => {
                const hasPayload = Boolean(event.payload && Object.keys(event.payload).length > 0);
                const payloadExpanded = expandedPayloadIds[event.id] === true;
                return (
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
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      subsystem:{event.subsystem || 'unknown'} · worker:{event.worker_id || 'n/a'}
                      {event.failure_reason ? ` · failure:${event.failure_reason}` : ''}
                    </div>
                    {(event.request_id || event.intent_id || event.task_id) && (
                      <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {event.request_id ? `request:${event.request_id} ` : ''}
                        {event.intent_id ? `intent:${event.intent_id} ` : ''}
                        {event.task_id ? `task:${event.task_id}` : ''}
                      </div>
                    )}
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={!hasPayload}
                        onClick={() => {
                          if (!hasPayload) return;
                          setExpandedPayloadIds((current) => ({
                            ...current,
                            [event.id]: !current[event.id],
                          }));
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                      >
                        {payloadExpanded ? 'Hide Payload' : 'Show Payload'}
                      </button>
                    </div>
                    {payloadExpanded && hasPayload && (
                      <pre className="mt-2 max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        {formatJsonForDisplay(event.payload, {
                          mode: jsonMode,
                          maskSensitive,
                        })}
                      </pre>
                    )}
                  </li>
                );
              })}
              {!selectedTraceLoading && selectedTraceEvents.length === 0 && !selectedTraceError && (
                <li className="text-slate-600 dark:text-slate-300">No events found for this trace.</li>
              )}
            </ol>

            <section className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Thread History
                </h3>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  onClick={() => setThreadHistoryExpanded((current) => !current)}
                >
                  {threadHistoryExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {selectedTraceContext?.transcriptPage.sessionId
                  ? `Session ${selectedTraceContext.transcriptPage.sessionId} · Room ${selectedTraceContext.transcriptPage.room || 'n/a'}`
                  : 'No transcript session resolved for this trace.'}
              </p>

              {threadHistoryExpanded && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                      disabled={!transcriptHasOlder || transcriptPagingDirection !== null}
                      onClick={() => {
                        if (!selectedTraceId || transcriptBeforeTs === null) return;
                        void loadTraceContext(selectedTraceId, {
                          direction: 'older',
                          beforeTs: transcriptBeforeTs,
                          mergeMode: 'prepend',
                        });
                      }}
                    >
                      {transcriptPagingDirection === 'older' ? 'Loading…' : 'Load Older'}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                      disabled={!transcriptHasNewer || transcriptPagingDirection !== null}
                      onClick={() => {
                        if (!selectedTraceId || transcriptAfterTs === null) return;
                        void loadTraceContext(selectedTraceId, {
                          direction: 'newer',
                          afterTs: transcriptAfterTs,
                          mergeMode: 'append',
                        });
                      }}
                    >
                      {transcriptPagingDirection === 'newer' ? 'Loading…' : 'Load Newer'}
                    </button>
                  </div>

                  {selectedTraceContextLoading && transcriptEntries.length === 0 ? (
                    <div className="text-sm text-slate-600 dark:text-slate-300">Loading transcript…</div>
                  ) : transcriptEntries.length === 0 ? (
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      No transcript lines available for this trace context.
                    </div>
                  ) : (
                    <ol className="max-h-72 space-y-2 overflow-auto text-sm">
                      {transcriptEntries.map((entry) => (
                        <li
                          key={entry.eventId}
                          className="rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {new Date(entry.timestamp).toLocaleTimeString()} ·{' '}
                            {entry.participantName || entry.participantId}
                          </div>
                          <div className="text-slate-800 dark:text-slate-100">{entry.text}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </section>
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

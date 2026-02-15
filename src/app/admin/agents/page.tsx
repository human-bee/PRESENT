'use client';

import { useCallback, useEffect, useState } from 'react';
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

export default function AgentAdminPage() {
  const [overview, setOverview] = useState<AgentOverviewResponse | null>(null);
  const [tasks, setTasks] = useState<AgentQueueTask[]>([]);
  const [traces, setTraces] = useState<AgentTraceEventRow[]>([]);
  const [workers, setWorkers] = useState<AgentWorkerHeartbeat[]>([]);
  const [auditEntries, setAuditEntries] = useState<AgentAuditEntry[]>([]);
  const [selectedTask, setSelectedTask] = useState<AgentQueueTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, queueRes, tracesRes, workersRes, auditRes] = await Promise.all([
        readJson<{ ok: boolean } & AgentOverviewResponse>('/api/admin/agents/overview'),
        readJson<{ tasks: AgentQueueTask[] }>('/api/admin/agents/queue?limit=200'),
        readJson<{ traces: AgentTraceEventRow[] }>('/api/admin/agents/traces?limit=200'),
        readJson<{ workers: AgentWorkerHeartbeat[] }>('/api/admin/agents/workers'),
        readJson<{ entries: AgentAuditEntry[] }>('/api/admin/agents/audit?limit=120'),
      ]);
      setOverview(overviewRes);
      setTasks(Array.isArray(queueRes.tasks) ? queueRes.tasks : []);
      setTraces(Array.isArray(tracesRes.traces) ? tracesRes.traces : []);
      setWorkers(Array.isArray(workersRes.workers) ? workersRes.workers : []);
      setAuditEntries(Array.isArray(auditRes.entries) ? auditRes.entries : []);
      setPollingEnabled(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load admin data';
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
  }, []);

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
    <main className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Agent Observability Admin</h1>
            <p className="text-sm text-slate-600">Swarm orchestration traces, queue state, worker health, and safe actions.</p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </header>

        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <AgentOpsOverview overview={overview} />

        <div className="grid gap-4 xl:grid-cols-2">
          <AgentQueueTable tasks={tasks} onSelectTask={setSelectedTask} />
          <AgentTraceTimeline traces={traces} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <AgentWorkerHealth workers={workers} />
          <AgentSafeActions selectedTask={selectedTask} onApplied={refresh} />
        </div>

        <AgentAuditLog entries={auditEntries} />
      </div>
    </main>
  );
}

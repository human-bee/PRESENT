'use client';

import { useState } from 'react';
import type { AgentQueueTask } from './types';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

type Props = {
  selectedTask: AgentQueueTask | null;
  onApplied: () => Promise<void>;
};

export function AgentSafeActions({ selectedTask, onApplied }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callAction = async (action: 'cancel' | 'retry' | 'requeue') => {
    if (!selectedTask) return;
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    const confirmed = window.confirm(`Apply "${action}" to task ${selectedTask.id}?`);
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseAuth('/api/admin/agents/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          targetTaskId: selectedTask.id,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed action (${res.status})`);
      }
      await onApplied();
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed action');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Safe Actions</h2>
      <p className="mt-2 text-xs text-slate-600">
        Selected task: <span className="font-mono">{selectedTask?.id || 'none'}</span>
      </p>
      <textarea
        className="mt-2 w-full rounded border border-slate-300 p-2 text-xs"
        rows={3}
        placeholder="Reason for audit trail..."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={busy}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="rounded bg-rose-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          disabled={busy || !selectedTask}
          onClick={() => void callAction('cancel')}
        >
          Cancel
        </button>
        <button
          className="rounded bg-amber-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          disabled={busy || !selectedTask}
          onClick={() => void callAction('retry')}
        >
          Retry
        </button>
        <button
          className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          disabled={busy || !selectedTask}
          onClick={() => void callAction('requeue')}
        >
          Requeue
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-rose-700">{error}</div>}
    </section>
  );
}

'use client';

import { useState } from 'react';
import type { AgentQueueTask } from './types';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

type Props = {
  selectedTask: AgentQueueTask | null;
  onApplied: () => Promise<void>;
  actionsAllowed: boolean;
};

export function AgentSafeActions({ selectedTask, onApplied, actionsAllowed }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callAction = async (action: 'cancel' | 'retry' | 'requeue') => {
    if (!actionsAllowed) {
      setError('Safe actions require allowlisted admin access.');
      return;
    }
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
        let serverError = text || `Failed action (${res.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: unknown };
          if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
            serverError = parsed.error;
          }
        } catch {}
        throw new Error(serverError);
      }
      await onApplied();
      setReason('');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed action';
      if (message.includes('forbidden') || message.includes('admin_allowlist_not_configured')) {
        setError('Safe actions require allowlisted admin access.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <h2 className="text-base font-semibold text-[#111827]">Safe Actions</h2>
      <p className="mt-2 text-sm text-[#334155]">
        Selected task: <span className="font-mono">{selectedTask?.id || 'none'}</span>
      </p>
      {!actionsAllowed && (
        <p className="mt-2 text-sm text-amber-700">Safe actions are disabled for non-allowlisted users.</p>
      )}
      <textarea
        className="mt-2 w-full rounded border border-[#cbd5e1] bg-[#ffffff] p-2 text-sm text-[#111827] placeholder:text-[#64748b]"
        rows={3}
        placeholder="Reason for audit trail..."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={busy || !actionsAllowed}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="rounded bg-rose-600 px-2 py-1 text-sm text-white disabled:opacity-50"
          disabled={busy || !selectedTask || !actionsAllowed}
          onClick={() => void callAction('cancel')}
        >
          Cancel
        </button>
        <button
          className="rounded bg-amber-600 px-2 py-1 text-sm text-white disabled:opacity-50"
          disabled={busy || !selectedTask || !actionsAllowed}
          onClick={() => void callAction('retry')}
        >
          Retry
        </button>
        <button
          className="rounded bg-blue-600 px-2 py-1 text-sm text-white disabled:opacity-50"
          disabled={busy || !selectedTask || !actionsAllowed}
          onClick={() => void callAction('requeue')}
        >
          Requeue
        </button>
      </div>
      {error && <div className="mt-2 text-sm text-rose-700">{error}</div>}
    </section>
  );
}

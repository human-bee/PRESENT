'use client';

import type { AgentOverviewResponse } from './types';

const QUEUE_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued Tasks',
  running: 'Running Tasks',
  failed: 'Failed Tasks',
  succeeded: 'Succeeded Tasks',
  canceled: 'Canceled Tasks',
};

const formatDuration = (durationMs: number | null | undefined): string => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 'n/a';
  }
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export function AgentOpsOverview({ overview }: { overview: AgentOverviewResponse | null }) {
  if (!overview) {
    return (
      <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
        <h2 className="text-base font-semibold text-[#111827]">Overview</h2>
        <p className="mt-2 text-sm text-[#475569]">No overview data yet.</p>
      </section>
    );
  }

  const queueEntries = Object.entries(overview.queue || {}).sort(([left], [right]) => {
    const order = ['queued', 'running', 'failed', 'succeeded', 'canceled'];
    return order.indexOf(left) - order.indexOf(right);
  });

  return (
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <h2 className="text-base font-semibold text-[#111827]">Overview</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {queueEntries.map(([status, count]) => (
          <div key={status} className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
            <div className="text-xs uppercase text-[#334155]">
              {QUEUE_STATUS_LABELS[status] ?? status}
            </div>
            <div className="text-lg font-semibold text-[#111827]">{count}</div>
          </div>
        ))}
        <div className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
          <div className="text-xs uppercase text-[#334155]">Active Workers</div>
          <div className="text-lg font-semibold text-[#111827]">
            {overview.activeWorkers ?? overview.workers.length}
          </div>
        </div>
        <div className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
          <div className="text-xs uppercase text-[#334155]">Traces (1h)</div>
          <div className="text-lg font-semibold text-[#111827]">{overview.tracesLastHour}</div>
        </div>
      </div>
      <p className="mt-2 text-sm text-[#475569]">
        Oldest queued age: {formatDuration(overview.queueOldestQueuedAgeMs)}
      </p>
      <p className="mt-3 text-sm text-[#475569]">
        Actor <span className="font-mono">{overview.actorUserId}</span> · Generated{' '}
        {new Date(overview.generatedAt).toLocaleString()}
      </p>
    </section>
  );
}

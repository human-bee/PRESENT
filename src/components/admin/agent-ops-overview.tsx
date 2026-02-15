'use client';

import type { AgentOverviewResponse } from './types';

export function AgentOpsOverview({ overview }: { overview: AgentOverviewResponse | null }) {
  if (!overview) {
    return (
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Overview</h2>
        <p className="mt-2 text-sm text-slate-500">No overview data yet.</p>
      </section>
    );
  }

  const queueEntries = Object.entries(overview.queue || {});

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Overview</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {queueEntries.map(([status, count]) => (
          <div key={status} className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-xs uppercase text-slate-600">{status}</div>
            <div className="text-lg font-semibold text-slate-900">{count}</div>
          </div>
        ))}
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-xs uppercase text-slate-600">Traces (1h)</div>
          <div className="text-lg font-semibold text-slate-900">{overview.tracesLastHour}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Generated {new Date(overview.generatedAt).toLocaleString()}</p>
    </section>
  );
}

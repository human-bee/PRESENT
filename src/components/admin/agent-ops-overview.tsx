'use client';

import type { AgentOverviewResponse } from './types';

export function AgentOpsOverview({ overview }: { overview: AgentOverviewResponse | null }) {
  if (!overview) {
    return (
      <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
        <h2 className="text-base font-semibold text-[#111827]">Overview</h2>
        <p className="mt-2 text-sm text-[#475569]">No overview data yet.</p>
      </section>
    );
  }

  const queueEntries = Object.entries(overview.queue || {});

  return (
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <h2 className="text-base font-semibold text-[#111827]">Overview</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {queueEntries.map(([status, count]) => (
          <div key={status} className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
            <div className="text-xs uppercase text-[#334155]">{status}</div>
            <div className="text-lg font-semibold text-[#111827]">{count}</div>
          </div>
        ))}
        <div className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
          <div className="text-xs uppercase text-[#334155]">Traces (1h)</div>
          <div className="text-lg font-semibold text-[#111827]">{overview.tracesLastHour}</div>
        </div>
      </div>
      <p className="mt-3 text-sm text-[#475569]">
        Actor <span className="font-mono">{overview.actorUserId}</span> · Generated{' '}
        {new Date(overview.generatedAt).toLocaleString()}
      </p>
    </section>
  );
}

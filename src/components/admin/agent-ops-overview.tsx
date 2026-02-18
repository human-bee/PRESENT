'use client';

import type { AgentOverviewResponse } from './types';

const QUEUE_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued Tasks',
  running: 'Running Tasks',
  failed: 'Failed Tasks',
  succeeded: 'Succeeded Tasks',
  canceled: 'Canceled Tasks',
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  cerebras: 'Cerebras',
  together: 'Together',
  debug: 'Debug',
  unknown: 'Unknown',
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
  const providerMixEntries = Object.entries(overview.providerMix || {}).sort(([left], [right]) => {
    const order = ['openai', 'anthropic', 'google', 'cerebras', 'together', 'debug', 'unknown'];
    return order.indexOf(left) - order.indexOf(right);
  });
  const providerFailureEntries = Object.entries(overview.providerFailures || {}).sort(([left], [right]) => {
    const order = ['openai', 'anthropic', 'google', 'cerebras', 'together', 'debug', 'unknown'];
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
      {(providerMixEntries.length > 0 || providerFailureEntries.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
            <div className="text-xs uppercase text-[#334155]">Provider Mix (1h)</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {providerMixEntries.map(([provider, count]) => (
                <div key={`mix-${provider}`} className="rounded border border-[#dbe3ed] bg-white px-2 py-1">
                  <span className="text-[#334155]">{PROVIDER_LABELS[provider] ?? provider}</span>
                  <span className="ml-2 font-semibold text-[#111827]">{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded border border-[#cbd5e1] bg-[#f8fafc] p-2">
            <div className="text-xs uppercase text-[#334155]">Provider Failures (1h)</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {providerFailureEntries.map(([provider, count]) => (
                <div key={`failure-${provider}`} className="rounded border border-[#dbe3ed] bg-white px-2 py-1">
                  <span className="text-[#334155]">{PROVIDER_LABELS[provider] ?? provider}</span>
                  <span className="ml-2 font-semibold text-[#111827]">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <p className="mt-3 text-sm text-[#475569]">
        Actor <span className="font-mono">{overview.actorUserId}</span> · Generated{' '}
        {new Date(overview.generatedAt).toLocaleString()}
      </p>
    </section>
  );
}

'use client';

import type { AgentWorkerHeartbeat } from './types';

const healthClasses: Record<string, string> = {
  online: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  offline: 'bg-rose-500',
};

export function AgentWorkerHealth({ workers }: { workers: AgentWorkerHeartbeat[] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Worker Health</h2>
      <div className="mt-3 space-y-2">
        {workers.map((worker) => (
          <div key={worker.worker_id} className="flex items-center justify-between rounded border border-slate-200 p-2 text-xs">
            <div className="min-w-0">
              <div className="font-mono text-slate-900">{worker.worker_id}</div>
              <div className="text-slate-500">
                host:{worker.host || 'n/a'} pid:{worker.pid || 'n/a'} active:{worker.active_tasks ?? 0}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${healthClasses[worker.health || 'offline'] || healthClasses.offline}`} />
              <span className="capitalize text-slate-700">{worker.health || 'offline'}</span>
            </div>
          </div>
        ))}
        {workers.length === 0 && <div className="text-xs text-slate-500">No workers reporting.</div>}
      </div>
    </section>
  );
}

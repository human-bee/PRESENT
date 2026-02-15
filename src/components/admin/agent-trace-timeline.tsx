'use client';

import type { AgentTraceEventRow } from './types';

export function AgentTraceTimeline({ traces }: { traces: AgentTraceEventRow[] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Trace Timeline</h2>
      <div className="mt-3 max-h-[320px] overflow-auto">
        <ol className="space-y-2 text-xs">
          {traces.map((event) => (
            <li key={event.id} className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-slate-900">
                  {event.stage}
                  {event.status ? ` · ${event.status}` : ''}
                </span>
                <span className="text-slate-500">
                  {event.created_at ? new Date(event.created_at).toLocaleTimeString() : 'n/a'}
                </span>
              </div>
              <div className="mt-1 text-slate-600">
                {(event.task || 'unknown-task')}{event.room ? ` · ${event.room}` : ''}
              </div>
              {(event.trace_id || event.request_id || event.intent_id) && (
                <div className="mt-1 font-mono text-[11px] text-slate-500">
                  {event.trace_id ? `trace:${event.trace_id} ` : ''}
                  {event.request_id ? `request:${event.request_id} ` : ''}
                  {event.intent_id ? `intent:${event.intent_id}` : ''}
                </div>
              )}
            </li>
          ))}
          {traces.length === 0 && <li className="text-slate-500">No trace events</li>}
        </ol>
      </div>
    </section>
  );
}

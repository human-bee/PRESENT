'use client';

import type { AgentTraceEventRow } from './types';

type Props = {
  traces: AgentTraceEventRow[];
  selectedTraceId?: string | null;
  onSelectTraceId?: (traceId: string) => void;
};

export function AgentTraceTimeline({
  traces,
  selectedTraceId = null,
  onSelectTraceId,
}: Props) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Trace Timeline</h2>
      <div className="mt-3 max-h-[320px] overflow-auto">
        <ol className="space-y-2 text-xs">
          {traces.map((event) => (
            <li
              key={event.id}
              className={[
                'rounded border bg-slate-50 p-2',
                event.trace_id && selectedTraceId === event.trace_id
                  ? 'border-sky-300 ring-1 ring-sky-200'
                  : 'border-slate-200',
              ].join(' ')}
            >
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
                  {event.trace_id ? (
                    <>
                      trace:
                      <button
                        type="button"
                        onClick={() => {
                          if (event.trace_id && onSelectTraceId) {
                            onSelectTraceId(event.trace_id);
                          }
                        }}
                        className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800 hover:bg-slate-300"
                        title="Open full trace timeline"
                      >
                        {event.trace_id}
                      </button>{' '}
                    </>
                  ) : null}
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

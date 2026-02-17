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
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <h2 className="text-base font-semibold text-[#111827]">Trace Timeline</h2>
      <div className="mt-3 max-h-[320px] overflow-auto">
        <ol className="space-y-2 text-sm">
          {traces.map((event) => (
            <li
              key={event.id}
              className={[
                'rounded border bg-[#f8fafc] p-2',
                event.trace_id && selectedTraceId === event.trace_id
                  ? 'border-sky-400 ring-1 ring-sky-300'
                  : 'border-[#cbd5e1]',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[#111827]">
                  {event.stage}
                  {event.status ? ` · ${event.status}` : ''}
                </span>
                <span className="text-[#475569]">
                  {event.created_at ? new Date(event.created_at).toLocaleTimeString() : 'n/a'}
                </span>
              </div>
              <div className="mt-1 text-[#334155]">
                {(event.task || 'unknown-task')}{event.room ? ` · ${event.room}` : ''}
              </div>
              {(event.subsystem || event.failure_reason) && (
                <div className="mt-1 text-xs text-[#475569]">
                  {event.subsystem ? `subsystem:${event.subsystem}` : ''}
                  {event.failure_reason ? `${event.subsystem ? ' · ' : ''}${event.failure_reason}` : ''}
                </div>
              )}
              {(event.trace_id || event.request_id || event.intent_id) && (
                <div className="mt-1 font-mono text-xs text-[#475569]">
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
                        className="ml-1 rounded bg-[#e2e8f0] px-1.5 py-0.5 text-xs font-semibold text-[#111827] hover:bg-[#cbd5e1]"
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
          {traces.length === 0 && <li className="text-[#475569]">No trace events</li>}
        </ol>
      </div>
    </section>
  );
}

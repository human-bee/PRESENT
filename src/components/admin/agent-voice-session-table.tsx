'use client';

import type { AgentVoiceSessionRow } from './types';

type Props = {
  sessions: AgentVoiceSessionRow[];
  available: boolean;
  toolIoAvailable: boolean;
  onSelectTraceId?: (traceId: string) => void;
};

const formatTime = (value: string | null) => {
  if (!value) return 'n/a';
  return new Date(value).toLocaleTimeString();
};

export function AgentVoiceSessionTable({
  sessions,
  available,
  toolIoAvailable,
  onSelectTraceId,
}: Props) {
  return (
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">Voice Sessions</h2>
          <p className="mt-1 text-sm text-[#475569]">
            Per-session proof from <span className="font-mono">agent_model_io</span>.
          </p>
        </div>
        {!toolIoAvailable && available && (
          <span className="rounded bg-[#fef3c7] px-2 py-1 text-xs text-[#92400e]">
            Tool replay unavailable
          </span>
        )}
      </div>

      {!available ? (
        <div className="mt-3 rounded border border-[#fcd34d] bg-[#fffbeb] px-3 py-2 text-sm text-[#92400e]">
          Voice session replay tables are unavailable in this environment.
        </div>
      ) : (
        <div className="mt-3 max-h-[320px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#f1f5f9] text-[#1f2937]">
              <tr>
                <th className="px-2 py-2">Started</th>
                <th className="px-2 py-2">Room</th>
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Control</th>
                <th className="px-2 py-2">Session</th>
                <th className="px-2 py-2">Activity</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.session_id} className="border-t border-[#e2e8f0] align-top">
                  <td className="px-2 py-2 text-[#475569]">{formatTime(session.started_at)}</td>
                  <td className="px-2 py-2 text-[#334155]">
                    <div className="font-mono text-xs">{session.room || 'n/a'}</div>
                    <div className="text-[11px] text-[#64748b]">
                      {session.participant_identity
                        ? `participant:${session.participant_identity}`
                        : session.worker_id
                          ? `origin:${session.worker_id}`
                          : 'origin:n/a'}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[#334155]">
                    <div className="font-mono">{session.model || 'model:n/a'}</div>
                    <div className="text-[11px] text-[#64748b]">
                      {session.provider || 'unknown'} · {session.provider_path || 'unknown'}
                    </div>
                    {session.provider_request_id && (
                      <div
                        className="max-w-[220px] truncate font-mono text-[11px] text-[#64748b]"
                        title={session.provider_request_id}
                      >
                        req:{session.provider_request_id}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[#334155]">
                    <div className="text-[11px] text-[#64748b]">
                      cfg:{session.config_version || 'n/a'}
                    </div>
                    <div className="text-[11px] text-[#64748b]">
                      {session.control_scope || 'unknown'} / {session.control_scope_id || 'n/a'}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[#334155]">
                    <div
                      className="max-w-[220px] truncate font-mono text-xs text-[#111827]"
                      title={session.session_id}
                    >
                      {session.session_id}
                    </div>
                    <div className="text-[11px] text-[#64748b]">
                      model:{session.event_count} · tools:{session.tool_call_count}
                    </div>
                    {session.trace_id && (
                      <button
                        type="button"
                        onClick={() => onSelectTraceId?.(session.trace_id as string)}
                        className="mt-1 rounded bg-[#e2e8f0] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#111827] hover:bg-[#cbd5e1]"
                        title="Open latest correlated trace"
                      >
                        trace:{session.trace_id}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[#334155]">
                    <div className="text-[11px] text-[#64748b]">
                      last:{formatTime(session.last_activity_at)}
                    </div>
                    <div className="text-[11px] text-[#64748b]">
                      tool:{session.last_tool_name || 'n/a'}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[#334155]">
                    <div className="font-medium">{session.status}</div>
                    <div
                      className="max-w-[220px] truncate text-[11px] text-[#64748b]"
                      title={session.close_reason || session.close_error || undefined}
                    >
                      {session.close_reason || session.close_error || 'active'}
                    </div>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-center text-[#475569]" colSpan={7}>
                    No voice sessions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

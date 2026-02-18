'use client';

import type { AgentQueueTask } from './types';

type Props = {
  tasks: AgentQueueTask[];
  onSelectTask: (task: AgentQueueTask) => void;
};

export function AgentQueueTable({ tasks, onSelectTask }: Props) {
  return (
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <h2 className="text-base font-semibold text-[#111827]">Queue Tasks</h2>
      <div className="mt-3 max-h-[320px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#f1f5f9] text-[#1f2937]">
            <tr>
              <th className="px-2 py-2">Task</th>
              <th className="px-2 py-2">Room</th>
              <th className="px-2 py-2">Worker</th>
              <th className="px-2 py-2">Provider</th>
              <th className="px-2 py-2">Trace</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Attempt</th>
              <th className="px-2 py-2">Failure Reason</th>
              <th className="px-2 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className="cursor-pointer border-t border-[#e2e8f0] hover:bg-[#f8fafc]"
                onClick={() => onSelectTask(task)}
              >
                <td className="px-2 py-2 font-mono text-[#111827]">{task.task}</td>
                <td className="px-2 py-2 text-[#334155]">{task.room}</td>
                <td className="px-2 py-2 font-mono text-xs text-[#334155]">{task.worker_id || 'n/a'}</td>
                <td className="px-2 py-2 text-xs text-[#334155]">
                  <div className="font-mono">{task.provider || 'unknown'}</div>
                  <div className="truncate text-[11px] text-[#64748b]" title={task.model || undefined}>
                    {task.model || 'model:n/a'}
                  </div>
                </td>
                <td className="px-2 py-2 font-mono text-xs text-[#334155]">
                  {task.trace_id ? task.trace_id.slice(0, 18) : 'n/a'}
                </td>
                <td className="px-2 py-2 text-[#334155]">{task.status}</td>
                <td className="px-2 py-2 text-[#334155]">{task.attempt}</td>
                <td className="max-w-[340px] truncate px-2 py-2 text-[#334155]" title={task.last_failure_reason || undefined}>
                  {task.last_failure_reason || 'n/a'}
                </td>
                <td className="px-2 py-2 text-[#475569]">
                  {task.created_at ? new Date(task.created_at).toLocaleTimeString() : 'n/a'}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td className="px-2 py-4 text-center text-[#475569]" colSpan={9}>
                  No tasks
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

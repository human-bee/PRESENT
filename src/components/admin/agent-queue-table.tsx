'use client';

import type { AgentQueueTask } from './types';

type Props = {
  tasks: AgentQueueTask[];
  onSelectTask: (task: AgentQueueTask) => void;
};

export function AgentQueueTable({ tasks, onSelectTask }: Props) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Queue Tasks</h2>
      <div className="mt-3 max-h-[320px] overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-100 text-slate-700">
            <tr>
              <th className="px-2 py-2">Task</th>
              <th className="px-2 py-2">Room</th>
              <th className="px-2 py-2">Trace</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Attempt</th>
              <th className="px-2 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => onSelectTask(task)}
              >
                <td className="px-2 py-2 font-mono text-slate-900">{task.task}</td>
                <td className="px-2 py-2 text-slate-700">{task.room}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-slate-600">
                  {task.trace_id ? task.trace_id.slice(0, 18) : 'n/a'}
                </td>
                <td className="px-2 py-2 text-slate-700">{task.status}</td>
                <td className="px-2 py-2 text-slate-700">{task.attempt}</td>
                <td className="px-2 py-2 text-slate-500">
                  {task.created_at ? new Date(task.created_at).toLocaleTimeString() : 'n/a'}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td className="px-2 py-4 text-center text-slate-500" colSpan={6}>
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

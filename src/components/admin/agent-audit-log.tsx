'use client';

import type { AgentAuditEntry } from './types';

export function AgentAuditLog({ entries }: { entries: AgentAuditEntry[] }) {
  return (
    <section className="rounded border border-[#cbd5e1] bg-[#ffffff] p-4">
      <h2 className="text-base font-semibold text-[#111827]">Action Audit Log</h2>
      <div className="mt-3 max-h-[280px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#f1f5f9] text-[#1f2937]">
            <tr>
              <th className="px-2 py-2">Time</th>
              <th className="px-2 py-2">Action</th>
              <th className="px-2 py-2">Task</th>
              <th className="px-2 py-2">Before</th>
              <th className="px-2 py-2">After</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-[#e2e8f0]">
                <td className="px-2 py-2 text-[#475569]">
                  {entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : 'n/a'}
                </td>
                <td className="px-2 py-2 font-mono text-[#111827]">{entry.action}</td>
                <td className="px-2 py-2 font-mono text-[#334155]">{entry.target_task_id || 'n/a'}</td>
                <td className="px-2 py-2 text-[#334155]">{entry.before_status || 'n/a'}</td>
                <td className="px-2 py-2 text-[#334155]">{entry.after_status || 'n/a'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-2 py-4 text-center text-[#475569]" colSpan={5}>
                  No audit entries
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

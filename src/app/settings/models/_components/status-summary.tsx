import type { ModelControlStatusResponse } from '../_lib/types';

type Props = {
  status: ModelControlStatusResponse | null;
  busy: boolean;
  onRefresh: () => void;
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function StatusSummary({ status, busy, onRefresh }: Props) {
  const keySourceSummary = (status?.keyStatus || []).map((entry) => {
    const label = entry.source === 'byok' ? 'BYOK' : entry.source === 'shared' ? 'Shared (Unlocked)' : 'Missing';
    return {
      provider: entry.provider,
      label,
      byokLast4: entry.byokLast4,
      sharedLast4: status?.isAdmin ? entry.sharedLast4 : undefined,
    };
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Effective Runtime Config</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border px-3 py-1.5 text-sm"
          disabled={busy}
        >
          Refresh
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">Config Version</div>
          <div className="mt-1 text-gray-700">{status?.resolved?.configVersion || 'n/a'}</div>
          <div className="mt-3 font-medium">Resolved At</div>
          <div className="mt-1 text-gray-700">{status?.resolved?.resolvedAt || 'n/a'}</div>
        </div>
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">Shared Unlock</div>
          <div className="mt-1 text-gray-700">{status?.unlockActive ? 'Unlocked' : 'Locked'}</div>
          <div className="mt-3 font-medium">Shared Password</div>
          <div className="mt-1 text-gray-700">{status?.keyringPolicy?.passwordRequired ? 'Required' : 'Not required'}</div>
          <div className="mt-3 font-medium">Admin Access</div>
          <div className="mt-1 text-gray-700">{status?.isAdmin ? 'Allowlisted Admin' : 'Standard User'}</div>
        </div>
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">Key Source By Provider</div>
          <ul className="mt-2 space-y-1">
            {keySourceSummary.map((entry) => (
              <li key={entry.provider} className="text-gray-700">
                {entry.provider}: {entry.label}
                {entry.byokLast4 ? ` (BYOK ••••${entry.byokLast4})` : ''}
                {!entry.byokLast4 && entry.sharedLast4 ? ` (Shared ••••${entry.sharedLast4})` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-800">Show resolved config JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
          {pretty(status?.resolved || {})}
        </pre>
      </details>
    </section>
  );
}

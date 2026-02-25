'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

type StatusResponse = {
  ok: boolean;
  isAdmin: boolean;
  unlockActive: boolean;
  keyringPolicy?: {
    passwordRequired: boolean;
    updatedAt?: string;
  };
  resolved: {
    configVersion: string;
    resolvedAt: string;
    effective: Record<string, unknown>;
    applyModes: Record<string, string>;
    sources: Array<Record<string, unknown>>;
  };
  keyStatus: Array<{
    provider: string;
    source: string;
    byokConfigured: boolean;
    byokLast4?: string;
    sharedConfigured: boolean;
    sharedEnabled: boolean;
    sharedLast4?: string;
  }>;
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export default function ModelControlsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [userConfigDraft, setUserConfigDraft] = useState(
    pretty({
      models: {},
      knobs: {},
    }),
  );
  const [adminProfileDraft, setAdminProfileDraft] = useState(
    pretty({
      scopeType: 'global',
      scopeId: 'global',
      priority: 100,
      enabled: true,
      config: {
        models: {},
        knobs: {},
      },
    }),
  );
  const [adminSharedKeyDraft, setAdminSharedKeyDraft] = useState(
    pretty({
      provider: 'openai',
      apiKey: '',
      enabled: true,
      delete: false,
    }),
  );
  const [adminPasswordDraft, setAdminPasswordDraft] = useState(
    pretty({
      password: '',
      required: false,
    }),
  );

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/auth/signin');
  }, [loading, user, router]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchWithSupabaseAuth('/api/model-controls/status');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed to load status (${res.status})`);
      }
      const json = (await res.json()) as StatusResponse;
      setStatus(json);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load model controls');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  const runAction = useCallback(
    async (request: () => Promise<Response>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await request();
        const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (payload && payload.ok === false) {
          const apply = payload.apply as { steps?: Array<{ service?: string; status?: string; detail?: string }> } | undefined;
          if (apply?.steps?.length) {
            const failed = apply.steps.filter((step) => step.status === 'failed');
            if (failed.length) {
              const message = failed
                .map((step) => `${step.service || 'service'}: ${step.detail || 'apply failed'}`)
                .join('; ');
              throw new Error(`Apply failed: ${message}`);
            }
          }
          throw new Error((payload.error as string) || 'Request failed');
        }
        if (!res.ok) {
          const text = typeof payload?.error === 'string' ? payload.error : '';
          throw new Error(text || `Request failed (${res.status})`);
        }
        await refresh();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Request failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const keySourceSummary = useMemo(() => {
    if (!status?.keyStatus) return [];
    return status.keyStatus.map((entry) => {
      const label =
        entry.source === 'byok'
          ? 'BYOK'
          : entry.source === 'shared'
            ? 'Shared (Unlocked)'
            : 'Missing';
      return {
        provider: entry.provider,
        label,
        byokLast4: entry.byokLast4,
        sharedLast4: status.isAdmin ? entry.sharedLast4 : undefined,
      };
    });
  }, [status?.isAdmin, status?.keyStatus]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Model Controls</h1>
            <p className="mt-1 text-sm text-gray-600">
              Unified prod control plane for models, operational knobs, BYOK, and shared admin keys.
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            <Link className="text-blue-700 underline" href="/settings/keys">
              Legacy Keys
            </Link>
            <Link className="text-blue-700 underline" href="/canvases">
              Back to canvases
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Effective Runtime Config</h2>
            <button
              type="button"
              onClick={() => void refresh()}
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
              <div className="mt-1 text-gray-700">
                {status?.keyringPolicy?.passwordRequired ? 'Required' : 'Not required'}
              </div>
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

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Shared Key Unlock</h2>
          <p className="mt-1 text-sm text-gray-600">
            Use optional admin password to enable shared fallback keys for this session.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              placeholder="Optional shared-key password"
              className="w-80 rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(async () =>
                  fetchWithSupabaseAuth('/api/model-controls/unlock-shared-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      password: unlockPassword || undefined,
                    }),
                  }),
                )
              }
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Unlock Shared Keys
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(async () =>
                  fetchWithSupabaseAuth('/api/model-controls/lock-shared-keys', {
                    method: 'POST',
                  }),
                )
              }
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Lock
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold">User Overrides</h2>
          <p className="mt-1 text-sm text-gray-600">
            Scoped to your user. JSON schema mirrors `ModelControlPatch`.
          </p>
          <textarea
            value={userConfigDraft}
            onChange={(event) => setUserConfigDraft(event.target.value)}
            className="mt-3 h-56 w-full rounded-md border p-3 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction(async () =>
                fetchWithSupabaseAuth('/api/model-controls/user-overrides', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    config: JSON.parse(userConfigDraft),
                    enabled: true,
                    priority: 100,
                  }),
                }),
              )
            }
            className="mt-3 rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Save User Overrides
          </button>
        </section>

        {status?.isAdmin ? (
          <section className="space-y-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
            <h2 className="text-lg font-semibold text-indigo-900">Admin Controls</h2>
            <div>
              <div className="text-sm font-medium text-indigo-900">Global/Scoped Profiles</div>
              <textarea
                value={adminProfileDraft}
                onChange={(event) => setAdminProfileDraft(event.target.value)}
                className="mt-2 h-48 w-full rounded-md border p-3 font-mono text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () =>
                    fetchWithSupabaseAuth('/api/admin/model-controls/profiles', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: adminProfileDraft,
                    }),
                  )
                }
                className="mt-2 rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Upsert Profile
              </button>
            </div>

            <div>
              <div className="text-sm font-medium text-indigo-900">Shared Provider Keys</div>
              <textarea
                value={adminSharedKeyDraft}
                onChange={(event) => setAdminSharedKeyDraft(event.target.value)}
                className="mt-2 h-40 w-full rounded-md border p-3 font-mono text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () =>
                    fetchWithSupabaseAuth('/api/admin/model-controls/shared-keys', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: adminSharedKeyDraft,
                    }),
                  )
                }
                className="mt-2 rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Upsert Shared Key
              </button>
            </div>

            <div>
              <div className="text-sm font-medium text-indigo-900">Shared Key Password Policy</div>
              <textarea
                value={adminPasswordDraft}
                onChange={(event) => setAdminPasswordDraft(event.target.value)}
                className="mt-2 h-32 w-full rounded-md border p-3 font-mono text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () =>
                    fetchWithSupabaseAuth('/api/admin/model-controls/shared-key-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: adminPasswordDraft,
                    }),
                  )
                }
                className="mt-2 rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Update Password Policy
              </button>
            </div>

            <div>
              <div className="text-sm font-medium text-indigo-900">Apply Restart-Bound Changes</div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () =>
                    fetchWithSupabaseAuth('/api/admin/model-controls/apply', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        reason: 'Applied from /settings/models',
                        targetConfigVersion: status?.resolved?.configVersion ?? null,
                      }),
                    }),
                  )
                }
                className="mt-2 rounded-md bg-indigo-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Apply Restart Changes
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

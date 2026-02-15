'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { getBooleanFlag } from '@/lib/feature-flags';

type ProviderId = 'openai' | 'anthropic' | 'google' | 'together' | 'cerebras';

type ProviderStatus = {
  provider: ProviderId;
  configured: boolean;
  last4?: string;
  updatedAt?: string;
};

type ProviderLinkState = {
  provider: ProviderId;
  state: 'linked_supported' | 'linked_unsupported' | 'api_key_configured' | 'missing';
  linked: boolean;
  apiKeyConfigured: boolean;
};

const demoMode = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);
const bypassAuth = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS, false);
const byokEnabled = !demoMode && !bypassAuth;

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  required: boolean;
  helpUrl: string;
  note: string;
}> = [
  {
    id: 'openai',
    label: 'OpenAI',
    required: true,
    helpUrl: 'https://platform.openai.com/api-keys',
    note: 'Required for voice + most stewards.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    required: false,
    helpUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Optional (Claude models).',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    required: false,
    helpUrl: 'https://aistudio.google.com/app/apikey',
    note: 'Optional (Gemini image model / AI Studio).',
  },
  {
    id: 'together',
    label: 'Together AI',
    required: false,
    helpUrl: 'https://api.together.ai/settings/api-keys',
    note: 'Optional (Flux fallback image generation).',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    required: false,
    helpUrl: 'https://cloud.cerebras.ai/',
    note: 'Optional (FAST stewards + router).',
  },
];

export default function ModelKeysPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null);
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({
    openai: '',
    anthropic: '',
    google: '',
    together: '',
    cerebras: '',
  });
  const [busy, setBusy] = useState<Record<ProviderId, boolean>>({
    openai: false,
    anthropic: false,
    google: false,
    together: false,
    cerebras: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [providerLinks, setProviderLinks] = useState<Record<ProviderId, ProviderLinkState | undefined>>({
    openai: undefined,
    anthropic: undefined,
    google: undefined,
    together: undefined,
    cerebras: undefined,
  });

  const statusByProvider = useMemo(() => {
    const map = new Map<ProviderId, ProviderStatus>();
    (statuses || []).forEach((s) => map.set(s.provider, s));
    return map;
  }, [statuses]);

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/auth/signin');
  }, [loading, user, router]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchWithSupabaseAuth('/api/model-keys');
      if (res.status === 404) {
        setStatuses([]);
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed to load keys (${res.status})`);
      }
      const json = await res.json();
      const keys = Array.isArray(json?.keys) ? (json.keys as ProviderStatus[]) : [];
      setStatuses(keys);
      try {
        const linksRes = await fetchWithSupabaseAuth('/api/provider-links');
        if (linksRes.ok) {
          const linksJson = await linksRes.json();
          const links = Array.isArray(linksJson?.links) ? (linksJson.links as ProviderLinkState[]) : [];
          const linkMap: Record<ProviderId, ProviderLinkState | undefined> = {
            openai: undefined,
            anthropic: undefined,
            google: undefined,
            together: undefined,
            cerebras: undefined,
          };
          for (const link of links) {
            if (link?.provider && link.provider in linkMap) {
              linkMap[link.provider] = link;
            }
          }
          setProviderLinks(linkMap);
        }
      } catch {
        // Non-fatal: key status still renders even if provider-link endpoint is unavailable.
      }
    } catch (error: unknown) {
      setError(getErrorMessage(error, 'Failed to load key status'));
      setStatuses(null);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!byokEnabled) return;
    void refresh();
  }, [user, refresh]);

  const setDraft = useCallback((provider: ProviderId, value: string) => {
    setDrafts((prev) => ({ ...prev, [provider]: value }));
  }, []);

  const save = useCallback(
    async (provider: ProviderId) => {
      const apiKey = drafts[provider].trim();
      if (!apiKey) return;
      setError(null);
      setBusy((prev) => ({ ...prev, [provider]: true }));
      try {
        const res = await fetchWithSupabaseAuth('/api/model-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Failed to save (${res.status})`);
        }
        await refresh();
        setDraft(provider, '');
      } catch (error: unknown) {
        setError(getErrorMessage(error, 'Failed to save key'));
      } finally {
        setBusy((prev) => ({ ...prev, [provider]: false }));
      }
    },
    [drafts, refresh, setDraft],
  );

  const clear = useCallback(
    async (provider: ProviderId) => {
      setError(null);
      setBusy((prev) => ({ ...prev, [provider]: true }));
      try {
        const res = await fetchWithSupabaseAuth('/api/model-keys', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Failed to delete (${res.status})`);
        }
        await refresh();
      } catch (error: unknown) {
        setError(getErrorMessage(error, 'Failed to delete key'));
      } finally {
        setBusy((prev) => ({ ...prev, [provider]: false }));
      }
    },
    [refresh],
  );

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!byokEnabled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h1 className="text-2xl font-bold text-gray-900">Model Keys</h1>
          <p className="mt-2 text-gray-700">
            BYOK is disabled in this session.
          </p>
          <div className="mt-6">
            <Link className="text-blue-600 underline" href="/canvases">
              Back to canvases
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Model Keys</h1>
            <p className="mt-1 text-gray-600">
              Add your own provider API keys to share the cost of AI features. Keys are encrypted on the server; only status is shown here.
            </p>
          </div>
          <Link className="text-sm text-blue-600 underline" href="/canvases">
            Back
          </Link>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-200">
            {PROVIDERS.map((p) => {
              const status = statusByProvider.get(p.id);
              const configured = status?.configured === true;
              const last4 = status?.last4 ? `••••${status.last4}` : '';
              const updatedAt = status?.updatedAt ? new Date(status.updatedAt).toLocaleString() : '';
              const linkState = providerLinks[p.id];
              const isBusy = busy[p.id];

              return (
                <div key={p.id} className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${configured ? 'bg-green-500' : 'bg-slate-300'}`}
                          aria-hidden
                        />
                        <div className="font-semibold text-slate-900">
                          {p.label}
                          {p.required && (
                            <span className="ml-2 inline-flex items-center rounded bg-slate-900 px-2 py-0.5 text-xs text-white">
                              required
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{p.note}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {configured ? (
                          <>
                            Configured {last4 ? `(${last4})` : ''}{updatedAt ? ` · Updated ${updatedAt}` : ''}
                          </>
                        ) : (
                          'Not configured'
                        )}
                        {linkState && (
                          <span className="ml-2 inline-flex items-center rounded border border-slate-200 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                            {linkState.state.replace('_', ' ')}
                          </span>
                        )}
                        <span className="ml-2">
                          <a className="text-blue-600 underline" href={p.helpUrl} target="_blank" rel="noreferrer">
                            Get key
                          </a>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="password"
                        placeholder={configured ? 'Replace key…' : 'Paste key…'}
                        value={drafts[p.id]}
                        onChange={(e) => setDraft(p.id, e.target.value)}
                        className="w-full sm:w-80 px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isBusy}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void save(p.id)}
                          disabled={isBusy || drafts[p.id].trim().length === 0}
                          className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                        >
                          {configured ? 'Update' : 'Save'}
                        </button>
                        <button
                          onClick={() => void clear(p.id)}
                          disabled={isBusy || !configured}
                          className="px-3 py-2 rounded border border-slate-300 text-slate-700 text-sm disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 text-xs text-slate-600">
          Tip: after saving OpenAI, refresh your canvas or reconnect LiveKit so the voice agent can start.
        </div>
      </div>
    </div>
  );
}

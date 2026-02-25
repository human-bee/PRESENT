'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { AdvancedJsonPanel } from './_components/advanced-json-panel';
import { AdminKeyringPanel } from './_components/admin-keyring-panel';
import { GuidedControlsPanel } from './_components/guided-controls-panel';
import { SharedKeyUnlockPanel } from './_components/shared-key-unlock-panel';
import { StatusSummary } from './_components/status-summary';
import { buildPatchFromGuided, GUIDED_SECTIONS, seedGuidedValues } from './_lib/guided-config';
import type { ModelControlStatusResponse } from './_lib/types';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export default function ModelControlsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<ModelControlStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [unlockPassword, setUnlockPassword] = useState('');
  const [guidedValues, setGuidedValues] = useState<Record<string, string>>({});
  const [guidedInitialized, setGuidedInitialized] = useState(false);

  const [userConfigDraft, setUserConfigDraft] = useState(pretty({ models: {}, knobs: {} }));
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

  const [adminScopeType, setAdminScopeType] = useState<'global' | 'room' | 'user' | 'task'>('global');
  const [adminScopeId, setAdminScopeId] = useState('global');
  const [adminTaskPrefix, setAdminTaskPrefix] = useState('');
  const [adminPriority, setAdminPriority] = useState('100');
  const [adminEnabled, setAdminEnabled] = useState(true);

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
      const json = (await res.json()) as ModelControlStatusResponse;
      setStatus(json);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load model controls');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  useEffect(() => {
    if (!status || guidedInitialized) return;
    setGuidedValues(seedGuidedValues(status.resolved?.effective));
    setGuidedInitialized(true);
  }, [guidedInitialized, status]);

  const runAction = useCallback(
    async (request: () => Promise<Response>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await request();
        const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (payload && payload.ok === false) {
          const apply = payload.apply as
            | { steps?: Array<{ service?: string; status?: string; detail?: string }> }
            | undefined;
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

  const onLoadEffectiveValues = useCallback(() => {
    setGuidedValues(seedGuidedValues(status?.resolved?.effective));
  }, [status?.resolved?.effective]);

  const onSaveGuidedUser = useCallback(() => {
    try {
      const config = buildPatchFromGuided(guidedValues);
      setUserConfigDraft(pretty(config));
      void runAction(async () =>
        fetchWithSupabaseAuth('/api/model-controls/user-overrides', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config,
            enabled: true,
            priority: 100,
          }),
        }),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Invalid guided config');
    }
  }, [guidedValues, runAction]);

  const onSaveGuidedAdmin = useCallback(() => {
    try {
      const config = buildPatchFromGuided(guidedValues);
      const priority = Number.parseInt(adminPriority, 10);
      if (!Number.isFinite(priority) || priority < 0 || priority > 1000) {
        throw new Error('Admin priority must be an integer between 0 and 1000');
      }
      const scopeId = adminScopeId.trim();
      if (!scopeId) {
        throw new Error('Admin scopeId is required');
      }
      const payload = {
        scopeType: adminScopeType,
        scopeId,
        taskPrefix: adminTaskPrefix.trim() || null,
        enabled: adminEnabled,
        priority,
        config,
      };
      setAdminProfileDraft(pretty(payload));
      void runAction(async () =>
        fetchWithSupabaseAuth('/api/admin/model-controls/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Invalid admin profile config');
    }
  }, [adminEnabled, adminPriority, adminScopeId, adminScopeType, adminTaskPrefix, guidedValues, runAction]);

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
            <Link className="text-blue-700 underline" href="/settings/models/reference">
              Model Reference
            </Link>
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

        <StatusSummary status={status} busy={busy} onRefresh={() => void refresh()} />

        <GuidedControlsPanel
          sections={GUIDED_SECTIONS}
          status={status}
          guidedValues={guidedValues}
          busy={busy}
          onGuidedFieldChange={(path, value) => setGuidedValues((current) => ({ ...current, [path]: value }))}
          onLoadEffectiveValues={onLoadEffectiveValues}
          onSaveGuidedUser={onSaveGuidedUser}
          onSaveGuidedAdmin={status?.isAdmin ? onSaveGuidedAdmin : undefined}
          adminProfileForm={
            status?.isAdmin
              ? {
                  scopeType: adminScopeType,
                  scopeId: adminScopeId,
                  taskPrefix: adminTaskPrefix,
                  priority: adminPriority,
                  enabled: adminEnabled,
                  onScopeTypeChange: (value) => {
                    setAdminScopeType(value);
                    if (value === 'global' && !adminScopeId.trim()) {
                      setAdminScopeId('global');
                    }
                  },
                  onScopeIdChange: setAdminScopeId,
                  onTaskPrefixChange: setAdminTaskPrefix,
                  onPriorityChange: setAdminPriority,
                  onEnabledChange: setAdminEnabled,
                }
              : undefined
          }
        />

        <SharedKeyUnlockPanel
          busy={busy}
          unlockPassword={unlockPassword}
          onUnlockPasswordChange={setUnlockPassword}
          onUnlock={() =>
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
          onLock={() =>
            void runAction(async () =>
              fetchWithSupabaseAuth('/api/model-controls/lock-shared-keys', {
                method: 'POST',
              }),
            )
          }
        />

        <AdvancedJsonPanel
          busy={busy}
          isAdmin={Boolean(status?.isAdmin)}
          userConfigDraft={userConfigDraft}
          onUserConfigDraftChange={setUserConfigDraft}
          onSaveUserJson={() =>
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
          adminProfileDraft={adminProfileDraft}
          onAdminProfileDraftChange={setAdminProfileDraft}
          onSaveAdminJson={() =>
            void runAction(async () =>
              fetchWithSupabaseAuth('/api/admin/model-controls/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: adminProfileDraft,
              }),
            )
          }
        />

        {status?.isAdmin ? (
          <AdminKeyringPanel
            busy={busy}
            adminSharedKeyDraft={adminSharedKeyDraft}
            onAdminSharedKeyDraftChange={setAdminSharedKeyDraft}
            onUpsertSharedKey={() =>
              void runAction(async () =>
                fetchWithSupabaseAuth('/api/admin/model-controls/shared-keys', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: adminSharedKeyDraft,
                }),
              )
            }
            adminPasswordDraft={adminPasswordDraft}
            onAdminPasswordDraftChange={setAdminPasswordDraft}
            onUpdatePasswordPolicy={() =>
              void runAction(async () =>
                fetchWithSupabaseAuth('/api/admin/model-controls/shared-key-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: adminPasswordDraft,
                }),
              )
            }
            onApplyRestartChanges={() =>
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
          />
        ) : null}
      </div>
    </div>
  );
}

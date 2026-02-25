import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUser } from '@/lib/supabase/server/resolve-request-user';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';
import { listUserModelKeyStatus } from '@/lib/agents/shared/user-model-keys';
import {
  getSharedKeyringPolicy,
  listSharedKeyStatus,
  getUnlockCookieToken,
  validateSharedUnlockSession,
} from '@/lib/agents/control-plane/shared-keys';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import type { ModelProvider, ResolvedModelControl } from '@/lib/agents/control-plane/types';

export const runtime = 'nodejs';

const PROVIDERS: ModelProvider[] = ['openai', 'anthropic', 'google', 'together', 'cerebras'];

const isMissingRelationError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('42p01') || (message.includes('relation') && message.includes('does not exist'));
};

const fallbackResolvedControl = (): ResolvedModelControl => ({
  effective: { models: {}, knobs: {} },
  sources: [],
  applyModes: {},
  fieldSources: {},
  resolvedAt: new Date().toISOString(),
  configVersion: 'env-fallback',
});

export async function GET(req: NextRequest) {
  const user = await resolveRequestUser(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const room = req.nextUrl.searchParams.get('room') || undefined;
  const task = req.nextUrl.searchParams.get('task') || undefined;
  const [resolved, userKeys, sharedKeys, keyringPolicy, adminCheck] = await Promise.all([
    resolveModelControl({
      room: room ?? undefined,
      task: task ?? undefined,
      userId: user.id,
      includeUserScope: true,
    }).catch((error): ResolvedModelControl => {
      if (isMissingRelationError(error)) {
        return fallbackResolvedControl();
      }
      throw error;
    }),
    listUserModelKeyStatus(user.id).catch((error): Awaited<ReturnType<typeof listUserModelKeyStatus>> => {
      if (isMissingRelationError(error)) {
        return [];
      }
      throw error;
    }),
    listSharedKeyStatus().catch((error): Awaited<ReturnType<typeof listSharedKeyStatus>> => {
      if (isMissingRelationError(error)) {
        return PROVIDERS.map((provider) => ({
          provider,
          configured: false,
          enabled: false,
        }));
      }
      throw error;
    }),
    getSharedKeyringPolicy().catch((error): Awaited<ReturnType<typeof getSharedKeyringPolicy>> => {
      if (isMissingRelationError(error)) {
        return {
          id: 1,
          password_hash: null,
          password_salt: null,
          password_required: false,
          updated_at: new Date().toISOString(),
        };
      }
      throw error;
    }),
    requireAgentAdminActionUserId(req),
  ]);
  const token = getUnlockCookieToken(req);
  const unlock = await validateSharedUnlockSession({
    token,
    userId: user.id,
    roomScope: room ?? null,
  }).catch(() => ({ ok: false as const }));
  const userByProvider = new Map(userKeys.map((entry) => [entry.provider, entry]));
  const sharedByProvider = new Map(sharedKeys.map((entry) => [entry.provider, entry]));
  const isAdmin = adminCheck.ok;
  const keyStatus = PROVIDERS.map((provider) => {
    const userKey = userByProvider.get(provider);
    const sharedKey = sharedByProvider.get(provider);
    const source =
      userKey?.configured ? 'byok' : unlock.ok && sharedKey?.configured && sharedKey.enabled ? 'shared' : 'missing';
    return {
      provider,
      source,
      byokConfigured: Boolean(userKey?.configured),
      byokLast4: userKey?.last4,
      sharedConfigured: Boolean(sharedKey?.configured),
      sharedEnabled: Boolean(sharedKey?.enabled),
      sharedLast4: isAdmin ? sharedKey?.last4 : undefined,
      unlockActive: unlock.ok,
    };
  });
  return NextResponse.json({
    ok: true,
    userId: user.id,
    room: room ?? null,
    task: task ?? null,
    isAdmin,
    unlockActive: unlock.ok,
    keyringPolicy: {
      passwordRequired: keyringPolicy.password_required,
      updatedAt: keyringPolicy.updated_at,
    },
    resolved,
    keyStatus,
  });
}

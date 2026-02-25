import type { NextRequest } from 'next/server';
import { getDecryptedUserModelKey, type ModelKeyProvider } from '@/lib/agents/shared/user-model-keys';
import {
  getSharedKeyringPolicy,
  getSharedModelKey,
  getUnlockCookieToken,
  validateSharedUnlockSession,
} from './shared-keys';
import type { ModelProvider, SharedKeySource } from './types';

const toModelKeyProvider = (provider: ModelProvider): ModelKeyProvider =>
  provider === 'openai' ||
  provider === 'anthropic' ||
  provider === 'google' ||
  provider === 'together' ||
  provider === 'cerebras'
    ? provider
    : 'openai';

export type ResolvedProviderKey = {
  source: SharedKeySource;
  provider: ModelProvider;
  key: string;
  sharedUnlockSessionId?: string;
};

export async function resolveProviderKeyWithFallback(params: {
  req: NextRequest;
  provider: ModelProvider;
  userId: string;
  billingUserId?: string | null;
  roomScope?: string | null;
}): Promise<ResolvedProviderKey | null> {
  const ownerUserId = params.billingUserId?.trim() || params.userId.trim();
  const byokKey = await getDecryptedUserModelKey({
    userId: ownerUserId,
    provider: toModelKeyProvider(params.provider),
  });
  if (byokKey) {
    return {
      source: 'byok',
      provider: params.provider,
      key: byokKey,
    };
  }
  const policy = await getSharedKeyringPolicy().catch(() => null);
  if (!policy) {
    return null;
  }
  const unlockToken = getUnlockCookieToken(params.req);
  if (policy.password_required && !unlockToken) {
    return null;
  }
  const valid = await validateSharedUnlockSession({
    token: unlockToken,
    userId: params.userId,
    roomScope: params.roomScope ?? null,
  });
  if (!valid.ok) return null;
  const sharedKey = await getSharedModelKey({ provider: params.provider });
  if (!sharedKey) return null;
  return {
    source: 'shared',
    provider: params.provider,
    key: sharedKey,
    sharedUnlockSessionId: valid.sessionId,
  };
}

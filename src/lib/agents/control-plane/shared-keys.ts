import { randomBytes, createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import * as nodeCrypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { consumeWindowedLimit } from '@/lib/server/traffic-guards';
import { decryptSecret, encryptSecret, last4 as toLast4 } from '@/lib/agents/shared/secret-crypto';
import type { ModelProvider } from './types';

const UNLOCK_COOKIE_NAME = 'present_model_unlock';
const UNLOCK_IDLE_MS = 20 * 60_000;
const UNLOCK_ABSOLUTE_MS = 8 * 60 * 60_000;
const UNLOCK_RATE_LIMIT_PER_MIN = 12;
const ARGON2_MEMORY_KIB = 64 * 1024;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_LENGTH = 32;

type SharedKeyRow = {
  provider: ModelProvider;
  ciphertext: string;
  iv: string;
  last4: string;
  enabled: boolean;
  updated_at: string;
};

type KeyringPolicyRow = {
  id: number;
  password_hash: string | null;
  password_salt: string | null;
  password_required: boolean;
  updated_at: string;
};

type UnlockSessionRow = {
  id: string;
  user_id: string;
  room_scope: string | null;
  session_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string;
  created_at: string;
};

type UnlockSessionValidation = {
  ok: boolean;
  reason?: 'missing' | 'expired' | 'revoked' | 'room_scope_mismatch';
  sessionId?: string;
};

const nowIso = () => new Date().toISOString();

const toTokenHash = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const normalizeRoomScope = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const passwordHashLegacyScrypt = (password: string, saltB64: string): string => {
  const salt = Buffer.from(saltB64, 'base64');
  const derived = scryptSync(password, salt, 64);
  return Buffer.from(derived).toString('base64');
};

const passwordHashArgon2id = (password: string, saltB64: string): string => {
  const argon2Sync = (nodeCrypto as typeof nodeCrypto & {
    argon2Sync?: (
      algorithm: string,
      options: {
        message: string;
        nonce: Buffer;
        memory: number;
        passes: number;
        parallelism: number;
        tagLength: number;
      },
    ) => Buffer;
  }).argon2Sync;
  if (typeof argon2Sync !== 'function') {
    return `scrypt_fallback$${passwordHashLegacyScrypt(password, saltB64)}`;
  }
  const salt = Buffer.from(saltB64, 'base64');
  const derived = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: ARGON2_MEMORY_KIB,
    passes: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
    tagLength: ARGON2_TAG_LENGTH,
  });
  return `argon2id$${Buffer.from(derived).toString('base64')}`;
};

const passwordMatches = (password: string, hashB64: string, saltB64: string): boolean => {
  const [algorithm, encodedHash] = hashB64.includes('$')
    ? (() => {
        const [prefix, ...rest] = hashB64.split('$');
        return [prefix, rest.join('$')];
      })()
    : ['scrypt_legacy', hashB64];
  const candidateHash =
    algorithm === 'argon2id'
      ? passwordHashArgon2id(password, saltB64).split('$').slice(1).join('$')
      : algorithm === 'scrypt' || algorithm === 'scrypt_legacy' || algorithm === 'scrypt_fallback'
        ? passwordHashLegacyScrypt(password, saltB64)
        : '';
  if (!candidateHash) return false;
  const candidate = Buffer.from(candidateHash, 'base64');
  const current = Buffer.from(encodedHash, 'base64');
  if (candidate.length !== current.length) return false;
  return timingSafeEqual(candidate, current);
};

export function unlockCookieName(): string {
  return UNLOCK_COOKIE_NAME;
}

export function createUnlockCookieValue(sessionToken: string): string {
  return sessionToken;
}

export function getUnlockCookieToken(req: NextRequest): string | null {
  const cookie = req.cookies.get(UNLOCK_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const trimmed = cookie.trim();
  return trimmed.length ? trimmed : null;
}

export async function listSharedKeyStatus(): Promise<Array<{ provider: ModelProvider; configured: boolean; enabled: boolean; last4?: string; updatedAt?: string }>> {
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('admin_model_shared_keys')
    .select('provider,last4,enabled,updated_at');
  if (error) {
    throw new Error(`Failed to list shared key status: ${error.message}`);
  }
  const rows = (data || []) as Array<{ provider: ModelProvider; last4: string; enabled: boolean; updated_at: string }>;
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return (['openai', 'anthropic', 'google', 'together', 'cerebras'] as const).map((provider) => {
    const hit = byProvider.get(provider);
    if (!hit) return { provider, configured: false, enabled: false };
    return {
      provider,
      configured: true,
      enabled: Boolean(hit.enabled),
      last4: hit.last4,
      updatedAt: hit.updated_at,
    };
  });
}

export async function upsertSharedModelKey(params: {
  provider: ModelProvider;
  apiKey: string;
  enabled?: boolean;
  actorUserId: string;
}): Promise<{ provider: ModelProvider; last4: string; enabled: boolean }> {
  const plaintext = params.apiKey.trim();
  if (!plaintext) throw new Error('apiKey is required');
  const encrypted = await encryptSecret({
    userId: 'shared-keyring',
    provider: params.provider,
    plaintext,
  });
  const row = {
    provider: params.provider,
    ciphertext: encrypted.ciphertextB64,
    iv: encrypted.ivB64,
    last4: toLast4(plaintext),
    enabled: params.enabled ?? true,
    updated_by: params.actorUserId,
    updated_at: nowIso(),
  };
  const db = getAdminSupabaseClient();
  const { error } = await db.from('admin_model_shared_keys').upsert(row, { onConflict: 'provider' });
  if (error) {
    throw new Error(`Failed to upsert shared key: ${error.message}`);
  }
  return { provider: params.provider, last4: row.last4, enabled: row.enabled };
}

export async function setSharedModelKeyEnabled(params: {
  provider: ModelProvider;
  enabled: boolean;
  actorUserId: string;
}): Promise<void> {
  const db = getAdminSupabaseClient();
  const { error } = await db
    .from('admin_model_shared_keys')
    .update({ enabled: params.enabled, updated_by: params.actorUserId, updated_at: nowIso() })
    .eq('provider', params.provider);
  if (error) {
    throw new Error(`Failed to update shared key status: ${error.message}`);
  }
}

export async function deleteSharedModelKey(params: { provider: ModelProvider }): Promise<void> {
  const db = getAdminSupabaseClient();
  const { error } = await db.from('admin_model_shared_keys').delete().eq('provider', params.provider);
  if (error) {
    throw new Error(`Failed to delete shared key: ${error.message}`);
  }
}

export async function getSharedModelKey(params: {
  provider: ModelProvider;
}): Promise<string | null> {
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('admin_model_shared_keys')
    .select('provider,ciphertext,iv,enabled')
    .eq('provider', params.provider)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to load shared key: ${error.message}`);
  }
  const row = data as Pick<SharedKeyRow, 'provider' | 'ciphertext' | 'iv' | 'enabled'> | null;
  if (!row?.enabled) return null;
  if (!row.ciphertext || !row.iv) return null;
  const plaintext = await decryptSecret({
    userId: 'shared-keyring',
    provider: params.provider,
    ciphertextB64: row.ciphertext,
    ivB64: row.iv,
  });
  const trimmed = plaintext.trim();
  return trimmed.length ? trimmed : null;
}

export async function getSharedKeyringPolicy(): Promise<KeyringPolicyRow> {
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('admin_model_keyring_policy')
    .select('id,password_hash,password_salt,password_required,updated_at')
    .eq('id', 1)
    .single();
  if (error) {
    throw new Error(`Failed to load keyring policy: ${error.message}`);
  }
  return data as KeyringPolicyRow;
}

export async function setSharedKeyringPassword(params: {
  password: string | null;
  required?: boolean;
  actorUserId: string;
}): Promise<{ passwordRequired: boolean }> {
  const password = typeof params.password === 'string' ? params.password.trim() : '';
  const shouldRequire = params.required ?? password.length > 0;
  const next = (() => {
    if (!password.length) {
      return {
        password_hash: null,
        password_salt: null,
        password_required: false,
      };
    }
    const salt = randomBytes(16).toString('base64');
    return {
      password_hash: passwordHashArgon2id(password, salt),
      password_salt: salt,
      password_required: shouldRequire,
    };
  })();
  const db = getAdminSupabaseClient();
  const { error } = await db
    .from('admin_model_keyring_policy')
    .upsert(
      {
        id: 1,
        ...next,
        updated_by: params.actorUserId,
        updated_at: nowIso(),
      },
      { onConflict: 'id' },
    );
  if (error) {
    throw new Error(`Failed to update keyring password policy: ${error.message}`);
  }
  return { passwordRequired: Boolean(next.password_required) };
}

export async function validateSharedKeyPassword(password: string | undefined): Promise<{ ok: boolean; reason?: string }> {
  const policy = await getSharedKeyringPolicy();
  if (!policy.password_required) {
    return { ok: true };
  }
  if (!policy.password_hash || !policy.password_salt) {
    return { ok: false, reason: 'password_policy_misconfigured' };
  }
  if (!password || !password.trim()) {
    return { ok: false, reason: 'password_required' };
  }
  const ok = passwordMatches(password.trim(), policy.password_hash, policy.password_salt);
  return ok ? { ok: true } : { ok: false, reason: 'invalid_password' };
}

export async function createSharedUnlockSession(params: {
  userId: string;
  roomScope?: string | null;
  ip?: string | null;
}): Promise<{ sessionId: string; token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(Math.min(now + UNLOCK_IDLE_MS, now + UNLOCK_ABSOLUTE_MS)).toISOString();
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('admin_model_unlock_sessions')
    .insert({
      id: randomUUID(),
      user_id: params.userId,
      room_scope: normalizeRoomScope(params.roomScope),
      session_token_hash: toTokenHash(token),
      expires_at: expiresAt,
      created_by_ip: params.ip ?? null,
      attempt_count: 0,
      updated_at: nowIso(),
      last_used_at: nowIso(),
    })
    .select('id,expires_at')
    .single();
  if (error) {
    throw new Error(`Failed to create unlock session: ${error.message}`);
  }
  return { sessionId: data.id as string, token, expiresAt: String(data.expires_at) };
}

export async function validateSharedUnlockSession(params: {
  token: string | null;
  userId: string;
  roomScope?: string | null;
}): Promise<UnlockSessionValidation> {
  if (!params.token) return { ok: false, reason: 'missing' };
  const now = new Date();
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('admin_model_unlock_sessions')
    .select('id,user_id,room_scope,session_token_hash,expires_at,revoked_at,last_used_at,created_at')
    .eq('session_token_hash', toTokenHash(params.token))
    .eq('user_id', params.userId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to validate unlock session: ${error.message}`);
  }
  const row = data as UnlockSessionRow | null;
  if (!row) return { ok: false, reason: 'missing' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  const desiredRoom = normalizeRoomScope(params.roomScope);
  if (row.room_scope && (!desiredRoom || row.room_scope !== desiredRoom)) {
    return { ok: false, reason: 'room_scope_mismatch' };
  }
  const nextExpires = new Date(Math.min(Date.now() + UNLOCK_IDLE_MS, new Date(row.created_at).getTime() + UNLOCK_ABSOLUTE_MS)).toISOString();
  await db
    .from('admin_model_unlock_sessions')
    .update({
      last_used_at: nowIso(),
      expires_at: nextExpires,
      updated_at: nowIso(),
    })
    .eq('id', row.id);
  return { ok: true, sessionId: row.id };
}

export async function resolveSharedKeyBySession(params: {
  sessionId: string;
  userId: string;
  provider: ModelProvider;
  roomScope?: string | null;
}): Promise<string | null> {
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('admin_model_unlock_sessions')
    .select('id,user_id,room_scope,expires_at,revoked_at')
    .eq('id', params.sessionId)
    .eq('user_id', params.userId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to validate shared-key session id: ${error.message}`);
  }
  const row = data as Pick<UnlockSessionRow, 'id' | 'user_id' | 'room_scope' | 'expires_at' | 'revoked_at'> | null;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  const roomScope = normalizeRoomScope(params.roomScope);
  if (row.room_scope && (!roomScope || row.room_scope !== roomScope)) return null;
  return getSharedModelKey({ provider: params.provider });
}

export async function revokeSharedUnlockSession(token: string | null): Promise<void> {
  if (!token) return;
  const db = getAdminSupabaseClient();
  const { error } = await db
    .from('admin_model_unlock_sessions')
    .update({ revoked_at: nowIso(), updated_at: nowIso() })
    .eq('session_token_hash', toTokenHash(token));
  if (error) {
    throw new Error(`Failed to revoke unlock session: ${error.message}`);
  }
}

export async function checkUnlockRateLimit(params: {
  userId: string;
  ip?: string | null;
}): Promise<{ ok: boolean; retryAfterSec: number }> {
  const key = `model-unlock:${params.userId}`;
  const result = consumeWindowedLimit(key, UNLOCK_RATE_LIMIT_PER_MIN, 60_000);
  return { ok: result.ok, retryAfterSec: result.retryAfterSec };
}

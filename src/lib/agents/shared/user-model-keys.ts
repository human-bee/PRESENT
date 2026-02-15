import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { decryptSecret, encryptSecret, last4 as computeLast4 } from './secret-crypto';

export const modelKeyProviderSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'together',
  'cerebras',
] as const);

export type ModelKeyProvider = z.infer<typeof modelKeyProviderSchema>;

export const MODEL_KEY_PROVIDERS = modelKeyProviderSchema.options;

type UserModelKeyRow = {
  user_id: string;
  provider: ModelKeyProvider;
  ciphertext: string;
  iv: string;
  last4: string;
  updated_at: string;
};

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase service configuration for BYOK (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type CacheEntry = { value: string; exp: number };
const decryptedCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

const cacheKey = (userId: string, provider: ModelKeyProvider) => `${userId}:${provider}`;

export async function upsertUserModelKey(params: {
  userId: string;
  provider: ModelKeyProvider;
  plaintextKey: string;
}): Promise<{ provider: ModelKeyProvider; last4: string }> {
  const userId = params.userId.trim();
  const provider = modelKeyProviderSchema.parse(params.provider);
  const plaintextKey = params.plaintextKey.trim();
  if (!plaintextKey) throw new Error('apiKey is required');

  const encrypted = await encryptSecret({ userId, provider, plaintext: plaintextKey });
  const last4 = computeLast4(plaintextKey);

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from('user_model_keys')
    .upsert(
      {
        user_id: userId,
        provider,
        ciphertext: encrypted.ciphertextB64,
        iv: encrypted.ivB64,
        last4,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

  if (error) {
    throw new Error(`Failed to save key: ${error.message}`);
  }

  decryptedCache.set(cacheKey(userId, provider), { value: plaintextKey, exp: Date.now() + CACHE_TTL_MS });
  return { provider, last4 };
}

export async function deleteUserModelKey(params: {
  userId: string;
  provider: ModelKeyProvider;
}): Promise<void> {
  const userId = params.userId.trim();
  const provider = modelKeyProviderSchema.parse(params.provider);

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from('user_model_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) {
    throw new Error(`Failed to delete key: ${error.message}`);
  }

  decryptedCache.delete(cacheKey(userId, provider));
}

export type ModelKeyStatus = {
  provider: ModelKeyProvider;
  configured: boolean;
  last4?: string;
  updatedAt?: string;
};

export async function listUserModelKeyStatus(userId: string): Promise<ModelKeyStatus[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('user_model_keys')
    .select('provider,last4,updated_at')
    .eq('user_id', userId.trim());

  if (error) throw new Error(`Failed to load key status: ${error.message}`);

  const rows = (data || []) as Array<Pick<UserModelKeyRow, 'provider' | 'last4' | 'updated_at'>>;
  const rowByProvider = new Map<ModelKeyProvider, Pick<UserModelKeyRow, 'last4' | 'updated_at'>>();
  for (const row of rows) {
    if (!row?.provider) continue;
    try {
      const provider = modelKeyProviderSchema.parse(row.provider);
      rowByProvider.set(provider, { last4: row.last4, updated_at: row.updated_at });
    } catch {
      continue;
    }
  }

  return MODEL_KEY_PROVIDERS.map((provider) => {
    const hit = rowByProvider.get(provider);
    return hit
      ? { provider, configured: true, last4: hit.last4, updatedAt: hit.updated_at }
      : { provider, configured: false };
  });
}

export async function getDecryptedUserModelKey(params: {
  userId: string;
  provider: ModelKeyProvider;
}): Promise<string | null> {
  const userId = params.userId.trim();
  const provider = modelKeyProviderSchema.parse(params.provider);
  const key = cacheKey(userId, provider);

  const now = Date.now();
  const cached = decryptedCache.get(key);
  if (cached && cached.exp > now) return cached.value;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('user_model_keys')
    .select('ciphertext,iv')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to load key: ${error.message}`);
  }
  if (!data?.ciphertext || !data?.iv) return null;

  const plaintext = await decryptSecret({
    userId,
    provider,
    ciphertextB64: String(data.ciphertext),
    ivB64: String(data.iv),
  });

  const cleaned = plaintext.trim();
  if (!cleaned) return null;

  decryptedCache.set(key, { value: cleaned, exp: now + CACHE_TTL_MS });
  return cleaned;
}

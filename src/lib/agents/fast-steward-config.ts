import Cerebras from '@cerebras/cerebras_cloud_sdk';

/**
 * Shared configuration for all FAST stewards.
 * 
 * Cerebras models available (Dec 2025):
 * - llama3.3-70b: ~2,100 tokens/sec (recommended default)
 * - gpt-oss-120b: ~3,000 tokens/sec (faster, newer)
 * - llama3.1-8b: ~2,200 tokens/sec (smaller, fastest)
 * - qwen3-32b: ~2,600 tokens/sec
 * 
 * Set FAST_STEWARD_MODEL env var to change for ALL fast stewards.
 * Or override per-steward with {STEWARD}_FAST_MODEL (e.g., LINEAR_STEWARD_FAST_MODEL)
 */

const DEFAULT_FAST_STEWARD_MODEL = 'llama3.3-70b';

const MODEL_ALIASES: Record<string, string> = {
  'llama-3.3-70b': 'llama3.3-70b',
  'llama3-3-70b': 'llama3.3-70b',
  'llama-3.1-8b': 'llama3.1-8b',
  'llama3-1-8b': 'llama3.1-8b',
  'qwen-3-32b': 'qwen3-32b',
};

export function normalizeFastStewardModel(model?: string | null): string {
  if (typeof model !== 'string') return DEFAULT_FAST_STEWARD_MODEL;
  const trimmed = model.trim();
  if (!trimmed) return DEFAULT_FAST_STEWARD_MODEL;
  const normalized = trimmed
    .toLowerCase()
    .replace(/^cerebras[:/]/, '')
    .replace(/\s+/g, '');
  return MODEL_ALIASES[normalized] ?? normalized;
}

// Single env var to control all fast stewards.
export const FAST_STEWARD_MODEL = normalizeFastStewardModel(process.env.FAST_STEWARD_MODEL);

// Shared Cerebras client - reused across all fast stewards
const clientByKey = new Map<string, Cerebras>();

export function getCerebrasClient(apiKey?: string): Cerebras {
  const resolved = (apiKey ?? process.env.CEREBRAS_API_KEY ?? '').trim();
  if (!resolved) {
    throw new Error('CEREBRAS_API_KEY missing for FAST stewards');
  }

  const cached = clientByKey.get(resolved);
  if (cached) return cached;

  const client = new Cerebras({ apiKey: resolved });
  clientByKey.set(resolved, client);
  return client;
}

// Helper to get model with optional per-steward override
export function getModelForSteward(stewardEnvVar?: string): string {
  if (stewardEnvVar && process.env[stewardEnvVar]) {
    return normalizeFastStewardModel(process.env[stewardEnvVar]!);
  }
  return FAST_STEWARD_MODEL;
}

// Check if Cerebras is configured
export function isFastStewardReady(apiKey?: string): boolean {
  return Boolean((apiKey ?? process.env.CEREBRAS_API_KEY ?? '').trim());
}




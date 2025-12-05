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

// Single env var to control all fast stewards
export const FAST_STEWARD_MODEL = process.env.FAST_STEWARD_MODEL || 'llama3.3-70b';

// Shared Cerebras client - reused across all fast stewards
let _client: Cerebras | null = null;

export function getCerebrasClient(): Cerebras {
  if (!_client) {
    _client = new Cerebras({
      apiKey: process.env.CEREBRAS_API_KEY,
    });
  }
  return _client;
}

// Helper to get model with optional per-steward override
export function getModelForSteward(stewardEnvVar?: string): string {
  if (stewardEnvVar && process.env[stewardEnvVar]) {
    return process.env[stewardEnvVar]!;
  }
  return FAST_STEWARD_MODEL;
}

// Check if Cerebras is configured
export function isFastStewardReady(): boolean {
  return Boolean(process.env.CEREBRAS_API_KEY);
}

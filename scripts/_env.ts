import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

export function loadPresentEnv(cwd = process.cwd()) {
  const localEnvPath = path.join(cwd, '.env.local');
  loadEnv({ path: localEnvPath });

  const configuredFallback = process.env.PRESENT_CANONICAL_ENV_PATH?.trim();
  const homeFallback =
    process.env.HOME && process.env.HOME.trim()
      ? path.join(process.env.HOME.trim(), 'PRESENT', '.env.local')
      : '';
  const fallbackEnvPath = configuredFallback || homeFallback;
  if (!fallbackEnvPath || fallbackEnvPath === localEnvPath || !fs.existsSync(fallbackEnvPath)) {
    return;
  }

  // Worktree env files are often partial, so a canonical checkout can backfill missing keys.
  loadEnv({ path: fallbackEnvPath, override: false });
}

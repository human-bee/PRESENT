import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { defineConfig } from '@playwright/test';

if (process.env.LIVE_VOICE !== '1') throw new Error('LIVE_VOICE=1 explicitly authorizes this real paid voice proof.');
const environment = process.env.PRESENT_ENV_FILE;
if (!environment || !isAbsolute(environment)) throw new Error('Provide an absolute configured PRESENT_ENV_FILE.');
const directory = process.env.PRESENT_VOICE_DATA_DIRECTORY ?? mkdtempSync(join(tmpdir(), 'present-voice-proof-'));
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4441';
if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(baseURL)) throw new Error('Voice proof owns a dedicated loopback server.');
process.env.PRESENT_VOICE_DATA_DIRECTORY = directory;
process.env.PRESENT_VOICE_PROOF_DIRECTORY ??= join(directory, 'proof');

export default defineConfig({
  testDir: './e2e', testMatch: 'voice-live.spec.ts', workers: 1, retries: 0,
  timeout: 100_000, reporter: 'list', outputDir: join(directory, 'results'),
  use: { baseURL },
  webServer: {
    command: 'node scripts/sync-assets.mjs && node --import tsx server/index.ts',
    cwd: process.cwd(), url: `${baseURL}/api/health`, reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PRESENT_PORT: new URL(baseURL).port, PRESENT_HOST: '127.0.0.1',
      PRESENT_ENV_FILE: environment, PRESENT_DATA_DIRECTORY: directory,
      PRESENT_ACCESS_MODE: 'local', PRESENT_ACCESS_DIRECTORY: join(directory, 'access'),
    },
  },
});

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Playwright loads config again in workers; preserve the parent-owned directory.
const directory = process.env.PRESENT_RELEASE_DATA_DIRECTORY ?? mkdtempSync(join(tmpdir(), 'present-release-story-'));
const baseURL = process.env.PRESENT_RELEASE_URL ?? 'http://127.0.0.1:4440';
if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(baseURL)) throw new Error('Release story requires a dedicated loopback port.');
// The worker must read the exact data directory owned by this config's server.
process.env.PRESENT_RELEASE_DATA_DIRECTORY = directory;

export default defineConfig({
  testDir: './e2e', testMatch: 'release-story.spec.ts', workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 10_000 }, reporter: 'list',
  outputDir: join(directory, 'results'),
  use: {
    baseURL, headless: true, channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || undefined,
    viewport: { width: 1440, height: 900 }, actionTimeout: 10_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/sync-assets.mjs && node --import tsx server/index.ts',
    cwd: process.cwd(), url: `${baseURL}/api/health`, reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PRESENT_PORT: new URL(baseURL).port, PRESENT_HOST: '127.0.0.1',
      PRESENT_DATA_DIRECTORY: directory, PRESENT_ENV_FILE: join(directory, 'absent.env'),
      PRESENT_ACCESS_MODE: 'local', PRESENT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      PRESENT_ACCESS_DIRECTORY: join(directory, 'access'),
      OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPSESAFE_AI_API: '',
      LIVEKIT_URL: '', NEXT_PUBLIC_LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '',
      LINEAR_API_KEY: '', YOUTUBE_API_KEY: '',
    },
  },
});

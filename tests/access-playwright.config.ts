import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = mkdtempSync(join(tmpdir(), 'present-access-browser-'));
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4334';
export default defineConfig({
  testDir: './e2e', testMatch: ['access-profile.spec.ts', 'access-reconnect.spec.ts'], workers: 1, timeout: 60000,
  reporter: 'list', outputDir: join(root, 'results'),
  use: { baseURL, headless: true, actionTimeout: 10000, channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || undefined, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/sync-assets.mjs && node --import tsx server/index.ts',
    cwd: process.cwd(), url: `${baseURL}/api/health`, reuseExistingServer: false,
    env: { PRESENT_PORT: new URL(baseURL).port, PRESENT_DATA_DIRECTORY: root, PRESENT_ENV_FILE: join(root, 'absent.env'), PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_SECRET: randomBytes(32).toString('hex'), PRESENT_ACCESS_ORIGIN: baseURL, PRESENT_ACCESS_DIRECTORY: join(root, 'access'), OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', LINEAR_API_KEY: '', YOUTUBE_API_KEY: '', TYPESAFE_API_KEY: '', TYPSESAFE_AI_API: '', LIVEKIT_URL: '', NEXT_PUBLIC_LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' },
  },
});

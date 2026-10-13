import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = process.env.PRESENT_PLANNING_DATA_DIRECTORY ?? mkdtempSync(join(tmpdir(), 'present-planning-review-'));
const baseURL = 'http://127.0.0.1:4448';
process.env.PRESENT_PLANNING_DATA_DIRECTORY = directory;
export default defineConfig({
  testDir: './e2e', testMatch: 'planning-review.spec.ts', workers: 1, retries: 0, timeout: 60000,
  outputDir: join(directory, 'results'), reporter: 'list', expect: { timeout: 8000 },
  use: { baseURL, headless: true, viewport: { width: 1440, height: 1000 }, actionTimeout: 10000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { cwd: process.cwd(), command: 'node scripts/sync-assets.mjs && node --import tsx server/index.ts', url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 60000,
    env: { PRESENT_PORT: '4448', PRESENT_HOST: '127.0.0.1', PRESENT_DATA_DIRECTORY: directory, PRESENT_ENV_FILE: join(directory, 'absent.env'), PRESENT_ACCESS_MODE: 'local', OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPE_SAFE_API_KEY: '', LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', LINEAR_API_KEY: '', YOUTUBE_API_KEY: '' },
  },
});

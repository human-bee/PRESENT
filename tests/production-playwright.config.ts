import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4335';

// These tests use UI inputs and public reads, so they also exercise the exact
// production bundle without the development-only editor inspection hook.
export default defineConfig(base, {
  testDir: './e2e',
  testMatch: ['widget-*.spec.ts', 'voice-layout.spec.ts', 'media.spec.ts'],
  use: { ...base.use, baseURL },
  webServer: {
    command: 'npm start',
    env: { PRESENT_PORT: new URL(baseURL).port, PRESENT_HOST: '127.0.0.1', PRESENT_ACCESS_MODE: 'local',
      PRESENT_ENV_FILE: process.env.PRESENT_ENV_FILE ?? '/tmp/present-no-provider-environment',
      PRESENT_DATA_DIRECTORY: `${process.cwd()}/.data/e2e-production` },
    url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 30_000,
  },
});

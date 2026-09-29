import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

const baseURL = 'http://127.0.0.1:4336';
export default defineConfig(base, {
  testDir: './e2e', testMatch: 'meeting-soak.spec.ts', testIgnore: [],
  timeout: (Number(process.env.PRESENT_SOAK_SECONDS ?? 120) + 180) * 1000,
  use: { ...base.use, baseURL, trace: 'off' },
  webServer: { command: 'npm start', url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 30000,
    env: { PRESENT_PORT: '4336', PRESENT_HOST: '127.0.0.1', PRESENT_ACCESS_MODE: 'local',
      PRESENT_ENV_FILE: '/tmp/present-no-provider-environment', PRESENT_DATA_DIRECTORY: `${process.cwd()}/.data/e2e-soak` } },
});

import { defineConfig } from '@playwright/test';

const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'npm run dev',
    env: { PRESENT_PORT: new URL(baseURL).port },
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

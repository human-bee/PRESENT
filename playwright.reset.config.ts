import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /reset-workspace\.e2e\.spec\.ts/,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'PORT=3011 npm run dev:reset',
    url: 'http://127.0.0.1:3011',
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    actionTimeout: 15000,
    baseURL: 'http://127.0.0.1:3011',
    ignoreHTTPSErrors: true,
    video: 'off',
    screenshot: 'off',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

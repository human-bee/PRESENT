import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 6000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 15000,
    baseURL: 'http://localhost:3000',
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

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /reset-workspace\.e2e\.spec\.ts/,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: [
    {
      command: 'npm run build && CODEX_BROKER_URL=http://127.0.0.1:4101 PORT=3011 npm run start',
      url: 'http://127.0.0.1:3011',
      reuseExistingServer: false,
      timeout: 240000,
    },
    {
      command:
        'CODEX_BROKER_PORT=4101 CODEX_BROKER_PUBLIC_BASE_URL=http://127.0.0.1:4101 CODEX_BROKER_DIRECT_TARGET_URL=http://127.0.0.1:3011/codex-remote-mock/index.html npm run codex:broker',
      url: 'http://127.0.0.1:4101/health',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
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

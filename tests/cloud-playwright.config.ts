import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: ['access-profile.spec.ts', 'cloud-smoke.spec.ts'],
  workers: 1, timeout: 180000, expect: { timeout: 15000 }, reporter: 'list', outputDir: `${process.cwd()}/test-results/cloud`,
  // Fixed isolated staging target. No production fallback and no local server.
  use: { baseURL: 'https://present-native-production.up.railway.app', headless: true,
    actionTimeout: 15000, viewport: { width: 1440, height: 900 },
    // Invite tokens/cookies must never enter uploaded traces or screenshots.
    screenshot: 'off', trace: 'off', video: 'off' },
});

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

export default async function () {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://present-native-production.up.railway.app');
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (await page.getByTestId('canvas-license-missing').isVisible()) {
      const directory = `${process.cwd()}/test-results/cloud`; await mkdir(directory, { recursive: true });
      // Anonymous setup screen only: no invitations, sessions, or room contents.
      await page.screenshot({ path: `${directory}/licensing-blocker.png` });
      throw new Error('Hosted UI acceptance BLOCKED: configure a valid VITE_TLDRAW_LICENSE_KEY at build time. Health is not demo readiness.');
    }
  } finally { await browser.close(); }
}

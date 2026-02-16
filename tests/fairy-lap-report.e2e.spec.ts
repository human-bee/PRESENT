import { test, expect } from '@playwright/test';
import path from 'node:path';
import {
  formatTimestamp,
  ensureDir,
  signInOrSignUp,
  snap,
  writeReport,
  type StepResult,
} from './fairy-lap-utils';

// Legacy client-side fairy UI flow retained for historical reference only.
// Supported runtime path is server-first via /api/steward/runCanvas (see fairy-voice-agent-lap.e2e.spec.ts).
test.describe.skip('Fairy lap (report, legacy client UI)', () => {
  test('runs a fairy prompt and writes a verified screenshot report', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);

    const runId = formatTimestamp(new Date());
    const outputDir = path.join('test-results', `fairy-lap-${runId}`);
    const imagesDir = path.join(outputDir, 'images');
    ensureDir(imagesDir);

    const results: StepResult[] = [];

    const recordStep = async (name: string, fn: () => Promise<string | undefined>) => {
      const start = Date.now();
      try {
        const screenshot = await fn();
        results.push({ name, status: 'PASS', durationMs: Date.now() - start, screenshot });
      } catch (error: any) {
        results.push({
          name,
          status: 'FAIL',
          durationMs: Date.now() - start,
          error: error?.message || String(error),
        });
        throw error;
      }
    };

    await recordStep('Sign in / sign up', async () => {
      await signInOrSignUp(page, {
        email: process.env.PLAYWRIGHT_EMAIL,
        password: process.env.PLAYWRIGHT_PASSWORD,
      });
      await page.waitForTimeout(2_000);
      return undefined;
    });

    await recordStep('Canvas loaded', async () => {
      await page.waitForSelector('[data-canvas-space="true"]', { timeout: 60_000 });
      await snap(page, imagesDir, '00-canvas-loaded.png');
      return '00-canvas-loaded.png';
    });

    await recordStep('Fairy HUD visible', async () => {
      const hud = page.getByTestId('fairy-hud');
      await expect(hud).toBeVisible({ timeout: 30_000 });
      await snap(page, imagesDir, '01-fairy-hud.png');
      return '01-fairy-hud.png';
    });

    await recordStep('Select fairy', async () => {
      const fairyToggle = page.locator('[data-testid^=\"fairy-toggle-\"]').first();
      await expect(fairyToggle).toBeVisible({ timeout: 30_000 });
      await fairyToggle.click();
      await page.waitForSelector('#fairy-message-input', { timeout: 30_000 });
      await snap(page, imagesDir, '02-fairy-selected.png');
      return '02-fairy-selected.png';
    });

    let initialShapeCount = 0;
    await recordStep('Send prompt', async () => {
      initialShapeCount = await page
        .evaluate(() => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return 0;
          return Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
        })
        .catch(() => 0);

      const input = page.locator('#fairy-message-input');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill('Draw a rectangle labeled Fairy Lap');
      await input.press('Enter');
      await snap(page, imagesDir, '03-prompt-sent.png');
      return '03-prompt-sent.png';
    });

    await recordStep('Actions applied', async () => {
      const status = page.locator('[data-testid="fairy-status"]');
      if (await status.count()) {
        await expect(status).toContainText(/thinking|ready/i, { timeout: 15_000 });
      }

      await page.waitForFunction(
        (prevCount: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const nextCount = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return nextCount > prevCount;
        },
        initialShapeCount,
        { timeout: 90_000 },
      );

      await snap(page, imagesDir, '04-actions-applied.png');
      return '04-actions-applied.png';
    });

    await recordStep('State persisted on reload', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('[data-canvas-space="true"]', { timeout: 60_000 });

      await page.waitForFunction(() => {
        const extras = (window as any).__presentCanvasExtras;
        return extras && typeof extras.fairyState === 'string';
      }, {}, { timeout: 30_000 });

      await snap(page, imagesDir, '05-state-persisted.png');
      return '05-state-persisted.png';
    });

    writeReport(outputDir, runId, results);
  });
});

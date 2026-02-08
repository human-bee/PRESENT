import { test, expect } from '@playwright/test';

test.describe('Canvas shell', () => {
  test('TLDraw renders and transcript toggles via Ctrl+K', async ({ page }) => {
    await page.goto('/canvas');

    // TLDraw mounts a .tl-container when ready.
    await expect(page.locator('.tl-container')).toBeVisible({ timeout: 60_000 });

    // Transcript panel should open with Ctrl+K (wired in TldrawWithCollaboration).
    await page.keyboard.press('Control+K');
    await expect(page.locator('[data-present-transcript-panel="true"]')).toHaveAttribute(
      'data-state',
      'open',
    );

    // Close via header action. Use DOM click to avoid fixed+transform viewport flake.
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement | null;
      btn?.click();
    });
    await expect(page.locator('[data-present-transcript-panel="true"]')).toHaveAttribute(
      'data-state',
      'closed',
    );
  });
});

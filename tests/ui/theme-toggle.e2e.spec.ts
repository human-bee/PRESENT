import { test, expect } from '@playwright/test';

test.describe('Theme bootstrap', () => {
  test('persisted theme applies before paint (data-theme + class)', async ({ page }) => {
    await page.addInitScript(() => {
      // Only seed once; later parts of this test intentionally override to verify persistence.
      if (!window.localStorage.getItem('present:theme')) {
        window.localStorage.setItem('present:theme', 'dark');
      }
    });
    await page.goto('/canvas');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    // TLDraw chrome should follow the app theme to avoid mixed light/dark tokens.
    await expect(page.locator('.tl-container')).toHaveClass(/tl-theme__dark/);

    // Flip to light and ensure it persists after reload.
    await page.evaluate(() => window.localStorage.setItem('present:theme', 'light'));
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('.tl-container')).toHaveClass(/tl-theme__light/);
  });
});

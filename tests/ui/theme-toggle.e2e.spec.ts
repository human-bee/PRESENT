import { test, expect } from '@playwright/test';

test.describe('Theme bootstrap', () => {
  test('persisted theme applies before paint (data-theme + class)', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('present:theme', 'dark');
    });
    await page.goto('/canvas');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Flip to light and ensure it persists after reload.
    await page.evaluate(() => window.localStorage.setItem('present:theme', 'light'));
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});


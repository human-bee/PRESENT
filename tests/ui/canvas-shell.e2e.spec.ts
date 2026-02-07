import { test, expect } from '@playwright/test';

test.describe('Canvas shell', () => {
  test('TLDraw renders and transcript toggles via Ctrl+K', async ({ page }) => {
    await page.goto('/canvas');

    // TLDraw mounts a .tl-container when ready.
    await expect(page.locator('.tl-container')).toBeVisible({ timeout: 60_000 });

    // Transcript panel should open with Ctrl+K (wired in TldrawWithCollaboration).
    await page.keyboard.press('Control+K');
    await expect(page.locator('[data-debug-source="messaging-message-form"]')).toBeVisible();

    // Close via header action.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('[data-debug-source="messaging-message-form"]')).toBeHidden();
  });
});


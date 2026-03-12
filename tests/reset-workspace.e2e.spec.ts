import { test, expect } from '@playwright/test';

test.describe('reset workspace shell', () => {
  test('renders the reset mission control shell as the primary entrypoint', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('body')).toContainText('Start Codex Turn');
    await expect(page.locator('body')).toContainText('Queue Canvas Task');
    await expect(page.locator('body')).toContainText('Create Patch Artifact');
    await expect(page.locator('body')).toContainText('Executors + Presence');
    await expect(page.locator('body')).toContainText('Recent Sessions');
    await expect(page.locator('body')).toContainText('OpenClaw + MCP Pack');
    await expect(page.locator('body')).toContainText('Collaborative Monaco + Yjs session');
    await expect(page.locator('body')).toContainText('Reset Board');
    await expect(page.locator('body')).toContainText('Server-owned TLDraw collaboration');
  });

  test('renders the archive notice on the legacy canvas route', async ({ page }) => {
    await page.goto('/canvas');
    await expect(page.getByText(/the standalone canvas is archived/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /open reset workspace/i })).toBeVisible();
  });
});

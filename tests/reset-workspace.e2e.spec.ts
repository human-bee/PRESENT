import { test, expect } from '@playwright/test';

const brokeredProxyUrl = /127\.0\.0\.1:4101\/sessions\/.+\/proxy\/(?:[^/]+\/)?$/;

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

  test('loads the live canvas route instead of the archived notice', async ({ page }) => {
    await page.goto('/canvas');
    await expect(page.locator('body')).toContainText(/loading canvas/i);
    await expect(page.locator('body')).toContainText(/connecting to collaboration room/i);
  });

  test('connects remote codex through the broker and renders the proxied iframe', async ({ page }) => {
    await page.goto('/');

    const workspacePath = page.getByPlaceholder('/srv/codex/repos/PRESENT');
    await workspacePath.fill('/srv/codex/repos/PRESENT');
    await page.getByRole('button', { name: /connect remote codex/i }).click();

    await expect(page.locator('body')).toContainText('Remote Codex');
    await expect(page.locator('body')).toContainText('/srv/codex/repos/PRESENT');
    await expect(page.locator('body')).toContainText('ready');
    await expect(page.locator('select')).toContainText('remote-codex:');

    const remoteFrame = page.locator('iframe[title="Remote Codex"]');
    await expect(remoteFrame).toHaveAttribute('src', brokeredProxyUrl);
    await expect(page.getByRole('link', { name: 'Pop Out' })).toHaveAttribute(
      'href',
      brokeredProxyUrl,
    );

    await page.reload();
    await expect(page.locator('iframe[title="Remote Codex"]')).toHaveAttribute(
      'src',
      brokeredProxyUrl,
    );
  });
});

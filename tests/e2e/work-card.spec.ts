import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { workRequestSchema } from '../../shared/work';

test('a new work card uses the supported server default with fast, low reasoning', async ({ page }) => {
  let request: unknown;
  // This request-contract scenario has a controlled available executor. It does
  // not infer workspace support from a planning catalog or touch an account.
  await page.route('**/api/agents', route => route.fulfill({ json: {
    defaultProvider: 'sol', providers: [
      { id: 'sol', name: 'Sol 6.1', model: 'gpt-6.1-sol', configured: true, reasoning: ['low', 'high'], fast: true },
      { id: 'luna', name: 'Luna 6', model: 'gpt-6-luna', configured: true, reasoning: ['low', 'high'], fast: true },
      { id: 'codex', name: 'Astra 6', model: 'gpt-6-astra', configured: true, reasoning: ['low', 'high'], fast: true },
    ], workspace: { supported: true, status: 'catalog-verified', executionVerified: false },
  } }));
  await page.route('**/api/work/start', async route => {
    request = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { error: 'The local Codex service is temporarily unavailable.' } });
  });
  await page.goto(`/r/${randomBytes(16).toString('hex')}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  await page.getByRole('button', { name: 'A commitment Assign it, start work, keep the result', exact: true }).click();
  await page.getByLabel('Work request', { exact: true }).fill('Create a tested score calculator.');
  await page.getByRole('button', { name: 'Start work', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The local Codex service is temporarily unavailable.');
  const accepted = workRequestSchema.parse(request);
  expect(accepted.provider).toBe('sol');
  expect(accepted.fast).toBe(true);
  expect(accepted.reasoning).toBe('low');
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  const models = page.getByRole('combobox', { name: 'Who’s making things?', exact: true });
  await expect(models).toBeVisible();
  await expect(models.locator('option[value="spark"]')).toHaveCount(0);
});

import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { workRequestSchema } from '../../shared/work';

test('a new work card uses the supported server default with fast, low reasoning', async ({ page }) => {
  let request: unknown;
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
  expect(accepted.provider).toBe('luna');
  expect(accepted.fast).toBe(true);
  expect(accepted.reasoning).toBe('low');
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  const models = page.getByRole('combobox', { name: 'Who’s making things?', exact: true });
  await expect(models).toBeVisible();
  await expect(models.locator('option[value="spark"]')).toHaveCount(0);
});

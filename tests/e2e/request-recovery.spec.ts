import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('a reload restores the original request identity and recovers its result', async ({ page }) => {
  const roomId = randomBytes(16).toString('hex');
  const requests: Record<string, unknown>[] = [];
  // Both endpoints are local fixtures. No provider is configured or contacted.
  await page.route('**/api/agents', route => route.fulfill({ json: { defaultProvider: 'sol', providers: [{ id: 'sol', name: 'Synthetic recovery fixture', model: 'fixture-sol', configured: true, reasoning: ['low'], fast: false }], voice: { configured: false } } }));
  await page.route('**/api/agents/generate', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: requests.length === 1 ? 502 : 200, json: requests.length === 1
      ? { error: 'The connection ended before the result arrived.' }
      : { kind: 'canvas', provider: 'sol', elapsedMs: 20, objectIds: [], replayed: true } });
  });
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('textbox', { name: 'Ask the room' }).fill('Draw an editable tree');
  await page.getByRole('button', { name: 'Create with agent' }).click();
  await expect(page.getByRole('button', { name: 'Recover result' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await expect(page.getByRole('textbox', { name: 'Ask the room' })).toHaveValue('Draw an editable tree');
  await page.getByRole('button', { name: 'Recover result' }).click();
  await expect(page.getByText('Recovered the previous result')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual({ ...requests[0], recoverOnly: true });
  await expect(page.getByRole('button', { name: 'Recover result' })).toHaveCount(0);
});

import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Editor } from 'tldraw';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { defaultProvider: 'sol', providers: [{ id: 'sol', model: 'gpt-6.1-sol', configured: true }] } }));
});

test('uploaded diagram pixels and identity survive reload; replay and fresh continuation are distinct', async ({ page, context }) => {
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 640, height: 360 });
  await fixture.setContent('<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="360" fill="white"/><rect x="30" y="100" width="150" height="100" fill="#2177c9"/><path d="M190 150H440" stroke="black" stroke-width="8"/><circle cx="510" cy="150" r="65" fill="#ef9530"/><text x="50" y="250" font-size="26">Source → delivery</text></svg>');
  const diagram = await fixture.screenshot(); await fixture.close();
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/agents/generate', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    await route.fulfill({ status: requests.length < 3 ? 409 : 200, json: requests.length < 3 ? { error: 'The earlier process ended.', requestState: 'interrupted' } : { kind: 'canvas', provider: 'sol', elapsedMs: 20, objectIds: [] } });
  });
  const roomId = randomBytes(16).toString('hex');
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'illustrative-flow.png', mimeType: 'image/png', buffer: diagram });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __presentEditor: Editor }).__presentEditor.getSelectedShapes().map(shape => shape.type))).toEqual(['image']);
  await page.getByRole('textbox', { name: 'Ask the room' }).fill('Animate the uploaded flow as editable native shapes.');
  await page.getByRole('button', { name: 'Create with agent' }).click();
  await expect(page.getByRole('button', { name: 'Recover result' })).toBeVisible();
  expect(requests[0].canvasImage).toMatch(/^data:image\/jpeg;base64,/);
  expect(String(requests[0].canvasImage).length).toBeGreaterThan(500);
  expect(String(requests[0].canvasImage).length).toBeLessThanOrEqual(1500000);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Recover result' })).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Recover result' }).click();
  await expect(page.getByRole('button', { name: 'Start a new continuation' })).toBeVisible();
  await expect(page.getByText('The earlier process ended. Inspect the room before starting a new continuation.', { exact: true })).toBeVisible();
  expect(requests[1]).toEqual({ ...requests[0], recoverOnly: true });
  await page.getByRole('button', { name: 'Start a new continuation' }).click();
  await expect(page.getByRole('button', { name: 'Recover result' })).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[2].requestId).not.toBe(requests[0].requestId);
  expect(requests[2].recoverOnly).toBeUndefined();
});

test('stop and reconnect retain the request without redispatch', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
  await page.route('**/api/agents/generate', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { await new Promise<void>(resolve => { release = resolve; }); await route.abort().catch(() => {}); }
    else await route.fulfill({ status: 409, json: { error: 'No completed result exists.', requestState: 'failed' } });
  });
  await page.goto(`/r/${randomBytes(16).toString('hex')}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('textbox', { name: 'Ask the room' }).fill('Animate a native delivery sequence');
  await page.getByRole('button', { name: 'Create with agent' }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Stop generation' }).click(); release?.();
  await expect(page.getByRole('button', { name: 'Recover result' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Recover result' })).toBeVisible();
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Create with agent' })).toBeDisabled();
  await page.getByRole('button', { name: 'Recover result' }).click();
  await expect(page.getByRole('button', { name: 'Start a new continuation' })).toBeVisible();
  expect(requests[1]).toEqual({ ...requests[0], recoverOnly: true });
});

import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318' });

type Box = { x: number; y: number; width: number; height: number };
function intersectionArea(a: Box, b: Box) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

test('@layout voice controls stay inside a mobile viewport after a failed connection', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // This is only a layout/error-path check. Real speech uses voice-live.spec.ts.
  let interceptedSessions = 0;
  // Match the pathname, including session URLs carrying room/session query IDs.
  // Every voice route is fulfilled locally; none can reach a provider through the server.
  await page.route(url => url.pathname.startsWith('/api/voice/'), route => {
    if (new URL(route.request().url()).pathname === '/api/voice/session') interceptedSessions += 1;
    return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic connection failure for layout verification.' }) });
  });
  await page.goto(`/r/${randomBytes(16).toString('hex')}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await expect(page.locator('.native-canvas .tl-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect.poll(() => interceptedSessions).toBe(1);
  await expect(page.locator('.voice-error')).toBeVisible();
  await page.getByRole('button', { name: 'Show voice transcript' }).click();
  for (const selector of ['.voice-caption', '.voice-panel']) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error(`${selector} was not rendered`);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  }
  const caption = await page.locator('.voice-caption').boundingBox();
  const composer = await page.locator('.composer').boundingBox();
  const panel = await page.locator('.voice-panel').boundingBox();
  const navigation = await page.locator('.canvas-navigation').boundingBox();
  if (!caption || !composer || !panel || !navigation) throw new Error('Voice and canvas controls must be visible');
  expect(caption.y + caption.height).toBeLessThanOrEqual(composer.y);
  expect(intersectionArea(caption, panel), 'The multiline caption must not sit under the transcript panel').toBe(0);
  expect(intersectionArea(caption, navigation), 'The voice caption must not cover canvas zoom controls').toBe(0);
  await page.screenshot({ path: info.outputPath('mobile-voice-panel.png') });
  await page.getByRole('button', { name: 'Close transcript' }).click();
  await expect(page.locator('.voice-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start listening', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Canvas tools' })).toBeVisible();
});

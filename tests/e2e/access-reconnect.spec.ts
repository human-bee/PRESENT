import { test, expect } from '@playwright/test';

test('signed canvas survives a closed event stream and transient access-check 503', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await expect(page.locator('.room-status')).toHaveText('here, together');
  const roomURL = page.url(), roomId = new URL(roomURL).pathname.split('/').pop()!;
  await page.getByRole('button', { name: 'Leave a thought' }).click();
  const note = page.locator('.tl-note__container').first();
  await note.dblclick({ position: { x: 90, y: 80 } });
  await note.locator('[contenteditable="true"]').fill('Keep this room through an outage');
  await page.keyboard.press('Escape');
  // Establish a server-confirmed baseline before intentionally reloading the transport.
  const savedText = async () => JSON.stringify((await (await page.request.get(`/api/room/${roomId}`)).json()).room.objects);
  await expect.poll(savedText).toContain('Keep this room through an outage');
  const before = await (await page.request.get(`/api/access/rooms/${roomId}`)).json();
  let eventsStarted = false, checks = 0;
  const eventsURL = `**/api/access/rooms/${roomId}/events`, grantURL = `**/api/access/rooms/${roomId}`;
  // Explicit browser-level transport fault injection, not a fake grant or fake app state.
  // Chromium's offline switch does not reliably close an already-open SSE connection.
  await page.route(eventsURL, route => { eventsStarted = true; return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' }); });
  await page.route(grantURL, route => {
    if (!eventsStarted) return route.continue();
    checks++; return route.fulfill({ status: 503, contentType: 'text/html', body: '<html>Temporary proxy outage</html>' });
  });
  await page.reload();
  await expect.poll(() => checks).toBeGreaterThan(0);
  await page.waitForTimeout(250); // Let the failing recheck settle and React render its result.
  await expect(note.locator('.tl-text-content')).toContainText('Keep this room through an outage');
  await expect(page.getByText('Your room access has ended. Ask the owner for help.')).toHaveCount(0);
  await expect(page).toHaveURL(roomURL);
  await page.unroute(eventsURL); await page.unroute(grantURL);
  const after = await (await page.request.get(`/api/access/rooms/${roomId}`)).json();
  expect(after.userId).toBe(before.userId);
  await note.dblclick({ position: { x: 90, y: 80 } });
  await note.locator('[contenteditable="true"]').fill('Same signed participant after recovery');
  await page.keyboard.press('Escape');
  await expect.poll(savedText).toContain('Same signed participant after recovery');
  await page.reload();
  await expect(note.locator('.tl-text-content')).toContainText('Same signed participant after recovery');
});

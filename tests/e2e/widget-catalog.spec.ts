import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { CAPABILITIES } from '../../shared/capabilities';

// Real UI inputs. Editor access is deliberately absent; DOM and server reads
// verify the result. A second browser context is an independent participant.
test('every built-in instrument adds, shares, moves and survives reload', async ({ browser, baseURL }, info) => {
  test.setTimeout(120_000);
  const room = randomBytes(16).toString('hex');
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const [writer, peer] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [], timings: { action: string; localMs: number; peerMs: number }[] = [];
  writer.on('pageerror', error => errors.push(error.message));
  peer.on('pageerror', error => errors.push(error.message));
  const read = async (page: Page) => (await (await page.request.get(`/api/room/${room}`)).json()).room.objects as { id: string; title: string; x: number; y: number }[];
  try {
    await Promise.all([writer.goto(`/r/${room}`), peer.goto(`/r/${room}`)]);
    await expect(writer.locator('.room-status')).toHaveText('here, together');
    await expect(peer.locator('.room-status')).toHaveText('here, together');
    const labels = ['A thought Native sticky note', 'A moment A shared timer', 'A voice Find your flow', 'A question Vote together', 'A sound Play together', ...CAPABILITIES.map(item => `${item.title} ${item.description}`)];
    for (const [index, label] of labels.entries()) {
      await writer.getByRole('button', { name: 'Add to room', exact: true }).click();
      const start = performance.now();
      await writer.getByRole('button', { name: label, exact: true }).click();
      // Native culling can unmount offscreen shapes; count canonical objects,
      // then fit the viewport and assert every object has a rendered shape.
      await expect.poll(async () => (await read(writer)).length).toBe(index + 1);
      await writer.getByRole('button', { name: 'Fit everything' }).click();
      await expect(writer.locator('.tl-shape')).toHaveCount(index + 1);
      const localMs = performance.now() - start;
      await peer.getByRole('button', { name: 'Fit everything' }).click();
      await expect(peer.locator('.tl-shape')).toHaveCount(index + 1);
      timings.push({ action: label, localMs, peerMs: performance.now() - start });
      await writer.keyboard.press('Escape');
    }
    const objects = await read(writer);
    expect(objects).toHaveLength(labels.length);
    // Canonical records are sorted by ID, not insertion order. Select the
    // instrument explicitly; a native sticky note has no widget drag header.
    const dice = objects.find(item => item.title === 'Dice table');
    expect(dice).toBeDefined();
    const id = dice!.id;
    const widget = writer.locator(`.tl-shape[data-shape-id="shape:${id}"]`);
    const peerWidget = peer.locator(`.tl-shape[data-shape-id="shape:${id}"]`);
    const peerStyleBefore = await peerWidget.getAttribute('style');
    const title = widget.locator('[title="Drag to move"]');
    await title.hover(); // Wait for the visible overview camera to settle before grabbing.
    const box = await title.boundingBox();
    if (!box) throw new Error('Dice table is not visible for dragging');
    const startX = box.x + box.width / 2, startY = box.y + box.height / 2;
    await writer.mouse.move(startX, startY);
    await writer.mouse.down();
    await writer.mouse.move(startX + 120, startY - 100, { steps: 8 });
    await writer.mouse.up();
    await expect.poll(async () => (await read(writer)).find(item => item.id === id)?.x).not.toBe(dice!.x);
    const moved = await read(writer);
    await expect(widget).toBeVisible();
    await expect.poll(() => peerWidget.getAttribute('style')).not.toBe(peerStyleBefore);
    await peer.reload();
    await expect(peer.locator('.room-status')).toHaveText('here, together');
    await expect.poll(() => read(peer)).toEqual(moved);
    await peer.getByRole('button', { name: 'Fit everything' }).click();
    await expect(peer.locator('.tl-shape')).toHaveCount(labels.length);
    await writer.getByRole('button', { name: 'Fit everything' }).click();
    await writer.screenshot({ path: info.outputPath('widget-catalog.png') });
    expect(errors).toEqual([]);
    await info.attach('add-to-visible-timings', { body: JSON.stringify({ timings, boundary: 'Playwright add click through persistence read, Fit click and DOM assertion; includes driver overhead and fit animation, not an isolated rendering or voice latency measurement.' }, null, 2), contentType: 'application/json' });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('composer keyboard shortcut and panel exclusivity survive repeated toggles', async ({ page }) => {
  await page.goto(`/r/${randomBytes(16).toString('hex')}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('textbox', { name: 'Ask the room' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Ask the room' })).not.toBeFocused();
  // Context menu opens the transcript without requesting a microphone.
  await page.getByRole('button', { name: 'Start listening', exact: true }).click({ button: 'right' });
  await expect(page.locator('.voice-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  await expect(page.locator('.add-menu')).toBeVisible();
  await expect(page.locator('.voice-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  await expect(page.locator('.add-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.popover')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  const document = CAPABILITIES.find(item => item.title === 'Shared document')!;
  await page.getByRole('button', { name: `${document.title} ${document.description}`, exact: true }).click();
  const editor = page.frameLocator('iframe[title="Shared document"]').getByRole('textbox', { name: 'Document Markdown' });
  await editor.fill('Keep ordinary typing inside this widget.');
  await editor.press('ControlOrMeta+k');
  await expect(page.getByRole('textbox', { name: 'Ask the room' })).toBeFocused();
  await page.keyboard.press('Escape');
  await editor.click();
  await editor.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('textbox', { name: 'Ask the room' })).toBeFocused();
  await expect(editor).toHaveValue('Keep ordinary typing inside this widget.');
});

test('operator model default respects an explicit saved preference (metadata fixture)', async ({ page }) => {
  const generated: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/agents/generate')) generated.push(request.url()); });
  await page.route('**/api/agents', route => route.fulfill({ json: { defaultProvider: 'terra', providers: ['luna', 'terra'].map(id => ({ id, name: id, model: `fixture-${id}`, configured: true, reasoning: ['low'], fast: false })), voice: { configured: false } } }));
  await page.goto(`/r/${randomBytes(16).toString('hex')}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Who’s making things?' });
  await expect(picker).toHaveValue('terra');
  await picker.selectOption('luna');
  await page.reload();
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  await expect(picker).toHaveValue('luna');
  expect(generated).toEqual([]);
});

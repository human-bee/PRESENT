import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { Editor, TLShape } from 'tldraw';

type NativeWindow = Window & { __presentEditor: Editor };
const sorted = (shapes: TLShape[]) => shapes.sort((a, b) => a.id.localeCompare(b.id));
const shapes = (page: Page) => page.evaluate(() => (window as unknown as NativeWindow).__presentEditor.getCurrentPageShapes()).then(sorted);
const selected = (page: Page) => page.evaluate(() => (window as unknown as NativeWindow).__presentEditor.getSelectedShapeIds());
async function bounds(page: Page, id: string) {
  return page.evaluate(id => {
    const editor = (window as unknown as NativeWindow).__presentEditor, box = editor.getShapePageBounds(id as TLShape['id']);
    if (!box) throw new Error('Missing native shape bounds');
    const screen = editor.pageToScreen({ x: box.x, y: box.y });
    return { x: box.x, y: box.y, w: box.w, h: box.h, center: { x: box.center.x, y: box.center.y },
      screen: { x: screen.x, y: screen.y } };
  }, id);
}
async function gesture(page: Page, points: number[][]) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}
async function clipboardFingerprint(page: Page) {
  return page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('text/html')) continue;
      const html = await (await item.getType('text/html')).text();
      if (!html.includes('data-tldraw')) continue;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return null;
  });
}
function expectSameBounds(actual: Awaited<ReturnType<typeof bounds>>, expected: Awaited<ReturnType<typeof bounds>>) {
  for (const key of ['x', 'y', 'w', 'h'] as const) expect(actual[key]).toBeCloseTo(expected[key], 5);
}

test('human native tools draw, erase, rotate, group, frame, copy, paste and undo across peers and reload', async ({ browser, baseURL }, info) => {
  const roomId = randomBytes(16).toString('hex');
  const a = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const b = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const blockedRequests: string[] = [];
  for (const context of [a, b]) {
    await context.route(/\/api\/(?:voice\/|media\/|work\/|agents\/generate|mcp\/(?:create|open|call))/, route => {
      blockedRequests.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(() => {
      Object.assign(window, { __nativePhysicalRequests: Number(sessionStorage.getItem('native-device-requests') ?? 0) });
      navigator.mediaDevices.getUserMedia = async () => {
        (window as unknown as { __nativePhysicalRequests: number }).__nativePhysicalRequests++;
        sessionStorage.setItem('native-device-requests', String((window as unknown as { __nativePhysicalRequests: number }).__nativePhysicalRequests));
        throw new Error('Physical devices are blocked in native tool proof');
      };
    });
  }
  const [writer, reader] = await Promise.all([a.newPage(), b.newPage()]);
  const proof: Record<string, unknown> = { roomId, at: new Date().toISOString(), input: 'Actual tool buttons, pointer gestures, native keyboard copy/paste; editor access is read-only.' };
  const sync = async () => {
    const local = await shapes(writer);
    await expect.poll(() => shapes(reader)).toEqual(local);
    const canonical = async () => {
      const response = await writer.request.get(`/api/room/${roomId}/document`);
      expect(response.status()).toBe(200);
      const document = await response.json();
      return sorted(document.snapshot.documents.map((item: { state: TLShape }) => item.state).filter((item: TLShape) => item.typeName === 'shape'));
    };
    await expect.poll(canonical).toEqual(local);
    return local;
  };
  try {
    await Promise.all([writer.goto(`/r/${roomId}`), reader.goto(`/r/${roomId}`)]);
    await expect(writer.locator('.room-status')).toHaveText('here, together');
    await expect(reader.locator('.room-status')).toHaveText('here, together');
    await writer.getByRole('button', { name: 'Draw · D', exact: true }).click();
    await gesture(writer, [[360, 280], [420, 315], [490, 280], [565, 310]]);
    await expect.poll(async () => (await shapes(writer)).map(shape => shape.type)).toEqual(['draw']);
    proof.pen = await sync();
    await writer.getByRole('button', { name: 'Erase · E', exact: true }).click();
    await gesture(writer, [[415, 280], [425, 335]]);
    await expect.poll(() => shapes(writer)).toEqual([]);
    await sync();
    await writer.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => shapes(writer)).toEqual(proof.pen);
    await sync();
    await writer.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => shapes(writer)).toEqual([]);
    proof.erased = await sync();

    await writer.getByRole('button', { name: 'Rectangle · R', exact: true }).click();
    await gesture(writer, [[350, 300], [550, 430]]);
    const rectangle = (await shapes(writer)).find(shape => shape.type === 'geo');
    if (!rectangle) throw new Error('Pointer-created rectangle missing');
    const beforeRotation = await bounds(writer, rectangle.id);
    const rotation = await writer.evaluate(() => {
      const editor = (window as unknown as NativeWindow).__presentEditor, box = editor.getSelectionPageBounds();
      if (!box) throw new Error('Rectangle not selected');
      const center = box.center, gap = 10 / editor.getZoomLevel(), dx = box.w / 2 + gap, dy = -box.h / 2 - gap, angle = Math.PI / 4;
      const start = editor.pageToScreen({ x: center.x + dx, y: center.y + dy });
      const end = editor.pageToScreen({ x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) });
      return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
    });
    await writer.mouse.move(rotation.start.x, rotation.start.y);
    await writer.mouse.down();
    await expect.poll(() => writer.evaluate(() => (window as unknown as NativeWindow).__presentEditor.getPath())).toBe('select.pointing_rotate_handle');
    await writer.mouse.move(rotation.end.x, rotation.end.y, { steps: 12 });
    await writer.mouse.up();
    const rotated = (await shapes(writer)).find(shape => shape.id === rectangle.id);
    expect(rotated?.type).toBe('geo');
    expect(rotated?.props).toEqual(rectangle.props);
    expect(rotated?.rotation).toBeCloseTo(Math.PI / 4, 2);
    expect((await bounds(writer, rectangle.id)).center.x).toBeCloseTo(beforeRotation.center.x, 2);
    expect((await bounds(writer, rectangle.id)).center.y).toBeCloseTo(beforeRotation.center.y, 2);
    proof.rotated = await sync();

    await writer.getByRole('button', { name: 'Text · T', exact: true }).click();
    await writer.mouse.click(680, 340);
    await writer.locator('.tl-text-input [contenteditable="true"]').pressSequentially('Native tools stay shared', { delay: 8 });
    await writer.keyboard.press('Escape');
    const textShape = (await shapes(writer)).find(shape => shape.type === 'text');
    if (!textShape) throw new Error('Keyboard-created native text missing');
    await expect(writer.locator('.tl-shape[data-shape-type="text"]')).toContainText('Native tools stay shared');
    await writer.getByRole('button', { name: 'Select · V', exact: true }).click();
    await writer.keyboard.press('ControlOrMeta+a');
    await expect.poll(async () => (await selected(writer)).length).toBe(2);
    const beforeGroup = await Promise.all([bounds(writer, rectangle.id), bounds(writer, textShape.id)]);
    await writer.getByRole('button', { name: 'Group', exact: true }).click();
    const group = (await shapes(writer)).find(shape => shape.type === 'group');
    if (!group) throw new Error('UI grouping did not create a native group');
    for (const id of [rectangle.id, textShape.id]) expect((await shapes(writer)).find(shape => shape.id === id)?.parentId).toBe(group.id);
    proof.grouped = await sync();
    await writer.getByRole('button', { name: 'Select · V', exact: true }).click();
    await writer.keyboard.press('ControlOrMeta+Shift+g');
    await expect.poll(async () => (await shapes(writer)).map(shape => shape.type).sort()).toEqual(['geo', 'text']);
    for (const id of [rectangle.id, textShape.id]) expect((await shapes(writer)).find(shape => shape.id === id)?.parentId).toBe(group.parentId);
    expectSameBounds(await bounds(writer, rectangle.id), beforeGroup[0]);
    expectSameBounds(await bounds(writer, textShape.id), beforeGroup[1]);
    proof.ungrouped = await sync();
    await writer.getByRole('button', { name: 'Group', exact: true }).click();
    const regrouped = (await shapes(writer)).find(shape => shape.type === 'group');
    if (!regrouped) throw new Error('UI regrouping did not create a native group');
    const beforeFrame = await bounds(writer, regrouped.id);
    await writer.getByRole('button', { name: 'Frame · F', exact: true }).click();
    await gesture(writer, [[280, 210], [1130, 590]]);
    const frame = (await shapes(writer)).find(shape => shape.type === 'frame');
    if (!frame) throw new Error('Pointer-created native frame missing');
    expect((await shapes(writer)).find(shape => shape.id === regrouped.id)?.parentId).toBe(frame.id);
    expectSameBounds(await bounds(writer, regrouped.id), beforeFrame);
    const originals = await sync();
    expect(originals).toHaveLength(4);
    proof.framed = originals;
    await expect.poll(() => selected(writer)).toEqual([frame.id]);
    await writer.getByRole('button', { name: 'Select · V', exact: true }).click();
    const previousClipboard = await clipboardFingerprint(writer);
    await writer.keyboard.press('ControlOrMeta+c');
    await expect.poll(async () => { const current = await clipboardFingerprint(writer); return current !== null && current !== previousClipboard; }).toBe(true);
    await writer.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await shapes(writer)).length).toBe(8);
    const pasted = await sync(), copies = pasted.filter(shape => !originals.some(original => original.id === shape.id));
    expect(copies.map(shape => shape.type).sort()).toEqual(['frame', 'geo', 'group', 'text']);
    const copyFrame = copies.find(shape => shape.type === 'frame'), copyGroup = copies.find(shape => shape.type === 'group');
    expect(copyGroup?.parentId).toBe(copyFrame?.id);
    for (const type of ['geo', 'text']) {
      const copy = copies.find(shape => shape.type === type), original = originals.find(shape => shape.type === type);
      expect(copy?.parentId).toBe(copyGroup?.id);
      expect(copy?.props).toEqual(original?.props);
      expect(copy?.rotation).toBe(original?.rotation);
    }
    expect(pasted.filter(shape => originals.some(original => original.id === shape.id))).toEqual(originals);
    proof.pasted = pasted;
    await writer.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => shapes(writer)).toEqual(originals);
    await sync();
    await writer.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => shapes(writer)).toEqual(pasted);
    proof.redone = await sync();
    await writer.getByRole('button', { name: 'Fit everything' }).click();
    let camera = '', stable = 0;
    await expect.poll(async () => { const current = await writer.evaluate(() => JSON.stringify((window as unknown as NativeWindow).__presentEditor.getCamera())); stable = current === camera ? stable + 1 : 0; camera = current; return stable; }).toBeGreaterThanOrEqual(2);
    await writer.screenshot({ path: info.outputPath('native-human-tools.png') });
    await Promise.all([writer.reload(), reader.reload()]);
    for (const page of [writer, reader]) await expect.poll(() => page.evaluate(() => Boolean((window as unknown as NativeWindow).__presentEditor))).toBe(true);
    await expect.poll(() => shapes(writer)).toEqual(pasted);
    proof.reloaded = await sync();
    proof.blockedProviderRequests = blockedRequests;
    proof.physicalDeviceRequests = await Promise.all([writer, reader].map(page => page.evaluate(() => (window as unknown as { __nativePhysicalRequests: number }).__nativePhysicalRequests)));
    expect(blockedRequests).toEqual([]);
    expect(proof.physicalDeviceRequests).toEqual([0, 0]);
  } finally {
    const path = info.outputPath('native-human-tools-proof.json');
    await writeFile(path, `${JSON.stringify(proof, null, 2)}\n`);
    await info.attach('native-human-tools-proof', { path, contentType: 'application/json' });
    await Promise.all([a.close(), b.close()]);
  }
});

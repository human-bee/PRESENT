import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, test, type Page } from '@playwright/test';
import type { Editor, TLRecord } from 'tldraw';
import type { RoomObject } from '../../shared/room';
import { recordsToRoom } from '../../shared/tldraw-adapter';

const note = (page: Page) => page.locator('.tl-note__container');
async function roomObjects(page: Page, roomId: string): Promise<RoomObject[]> {
  const response = await page.request.get(`/api/room/${roomId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).room.objects;
}
async function editNote(page: Page, text: string, sequential = false) {
  await note(page).dblclick({ position: { x: 90, y: 80 } });
  const input = note(page).locator('[contenteditable="true"]');
  if (sequential) await input.pressSequentially(text, { delay: 10 });
  else await input.fill(text);
  await page.keyboard.press('Escape');
  await expect(note(page).locator('.tl-text-content')).toContainText(text);
}
async function geometry(page: Page, id: string) {
  return page.evaluate(id => {
    const shape = (window as unknown as { __presentEditor: Editor }).__presentEditor.getShape(`shape:${id}` as never);
    return shape ? { x: shape.x, y: shape.y, props: shape.props } : null;
  }, id);
}
const stableObjects = (objects: RoomObject[]) => objects.map(object => ({
  id: object.id, kind: object.kind, x: object.x, y: object.y, w: object.w, h: object.h, data: object.data,
})).sort((a, b) => a.id.localeCompare(b.id));
const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: samples.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) };
};

test('real browser edits, peer correction, shared timer and released placement survive disk and reload', async ({ browser, baseURL }, info) => {
  const directory = process.env.PRESENT_RELEASE_DATA_DIRECTORY;
  if (!directory) throw new Error('Use tests/release-playwright.config.ts for isolated disk proof.');
  const roomId = randomBytes(16).toString('hex');
  const contexts = await Promise.all(['Alex', 'River'].map(async name => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    await context.addInitScript(name => { if (window === window.top) localStorage.setItem('present:name', name); }, name);
    return context;
  }));
  const [alex, river] = await Promise.all(contexts.map(context => context.newPage()));
  const providerRequests: string[] = [];
  for (const page of [alex, river]) page.on('request', request => {
    if (/\/api\/(generate|voice|work\/start)/.test(new URL(request.url()).pathname)) providerRequests.push(new URL(request.url()).pathname);
  });
  try {
    await Promise.all([alex.goto(`/r/${roomId}`), river.goto(`/r/${roomId}`)]);
    await expect(alex.locator('.person-name', { hasText: 'River' })).toBeVisible();
    const actors = await Promise.all([alex, river].map(page => page.evaluate(() => sessionStorage.getItem('present:member-id'))));
    expect(actors.every(Boolean)).toBe(true);
    expect(actors[0]).not.toBe(actors[1]);
    await alex.getByRole('button', { name: 'Leave a thought' }).click();
    await editNote(alex, 'Meeting starts at nine.', true);
    await expect(note(river).locator('.tl-text-content')).toContainText('Meeting starts at nine.');
    const correction = 'Correction: meeting starts at ten.';
    await editNote(river, correction);
    await expect(note(alex).locator('.tl-text-content')).toContainText(correction);
    const thought = (await roomObjects(alex, roomId)).find(object => object.kind === 'note');
    if (!thought) throw new Error('The typed native note did not reach the canonical room.');

    // Bound a real UI benchmark. One host monotonic clock includes Playwright command and
    // observation overhead. DOM visibility is evidence of rendering, not physical display pixels.
    const samples: { directMs: number; peerMs: number }[] = [];
    await note(alex).dblclick({ position: { x: 90, y: 80 } });
    const input = note(alex).locator('[contenteditable="true"]');
    // Selecting all then collapsing right reaches the document end even when
    // the native note wraps; the macOS End key only moves within the first line.
    await input.press('ControlOrMeta+a');
    await input.press('ArrowRight');
    for (let index = 0; index < 20; index++) {
      const text = `${correction}${'x'.repeat(index + 1)}`;
      const start = performance.now();
      const observed = [alex, river].map(async page => {
        await expect(note(page)).toContainText(text);
        return performance.now() - start;
      });
      await input.pressSequentially('x');
      const [directMs, peerMs] = await Promise.all(observed);
      samples.push({ directMs, peerMs });
    }
    await alex.keyboard.press('Escape');
    await editNote(river, correction);
    await expect(note(alex).locator('.tl-text-content')).toContainText(correction);

    const original = await geometry(alex, thought.id);
    const box = await note(alex).boundingBox();
    if (!box) throw new Error('Missing note drag bounds.');
    await alex.mouse.move(box.x + 80, box.y + 24);
    await alex.mouse.down();
    await alex.mouse.move(box.x - 180, box.y - 56, { steps: 12 });
    await alex.mouse.up();
    await expect.poll(async () => (await geometry(alex, thought.id))?.x).not.toBe(original?.x);
    const released = await geometry(alex, thought.id);
    await expect.poll(() => geometry(river, thought.id)).toEqual(released);

    await alex.getByRole('button', { name: 'Add to room', exact: true }).click();
    await alex.getByRole('button', { name: 'A moment A shared timer' }).click();
    await alex.getByLabel('Timer duration').selectOption('60000');
    await alex.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(river.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect.poll(() => river.getByRole('timer').textContent()).not.toBe('1:00');
    await river.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(alex.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    const paused = await river.getByRole('timer').innerText();
    await expect(alex.getByRole('timer')).toHaveText(paused);
    const canonical = stableObjects(await roomObjects(alex, roomId));
    expect(canonical).toHaveLength(2);
    expect(canonical.find(object => object.kind === 'note')?.data.text).toBe(correction);
    expect(canonical.find(object => object.kind === 'timer')?.data.endsAt).toBeNull();
    const path = join(directory, 'tldraw', `${roomId}.json`);
    let snapshotBytes = Buffer.alloc(0);
    await expect.poll(() => {
      try {
        snapshotBytes = readFileSync(path);
        const snapshot = JSON.parse(snapshotBytes.toString());
        return stableObjects(recordsToRoom(roomId, snapshot.documents.map((document: { state: TLRecord }) => document.state)).objects);
      } catch { return null; }
    }).toEqual(canonical);
    await Promise.all([alex.reload(), river.reload()]);
    for (const page of [alex, river]) {
      await expect(note(page).locator('.tl-text-content')).toContainText(correction);
      await expect.poll(() => geometry(page, thought.id)).toEqual(released);
      await expect(page.getByRole('timer')).toHaveText(paused);
      expect(stableObjects(await roomObjects(page, roomId))).toEqual(canonical);
      await page.getByRole('button', { name: 'Fit everything' }).click();
      await page.screenshot({ path: info.outputPath(page === alex ? 'initiator.png' : 'peer.png') });
    }
    expect(providerRequests).toEqual([]);
    const proof = JSON.stringify({
      at: new Date().toISOString(), roomId, directory, actors, contexts: 2, physicalDevices: false,
      runtime: { node: process.version, browser: browser.version(), channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || 'Playwright Chromium' },
      source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex') },
      input: 'Real browser keyboard, native contenteditable, pointer down/move/up, timer controls.',
      correction, released, paused, canonical, providerRequests,
      disk: { path, sha256: createHash('sha256').update(snapshotBytes).digest('hex') },
      benchmark: { boundary: 'Host monotonic performance.now before real keyboard command through Playwright DOM observation; includes automation and polling overhead. Local loopback, two independent contexts, no providers, no acoustic or physical display claim.',
        rounds: 20, direct: stats(samples.map(sample => sample.directMs)), peer: stats(samples.map(sample => sample.peerMs)), rawSamples: samples },
    }, null, 2);
    writeFileSync(info.outputPath('release-story.json'), `${proof}\n`);
    await info.attach('release-story.json', { contentType: 'application/json', path: info.outputPath('release-story.json') });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Read-only production/migration acceptance for the two preserved prototype rooms.
// No model, device, work-start, or native editing requests are permitted.
const origin = process.env.PRESENT_MILESTONE_URL ?? 'http://127.0.0.1:4317';
const output = 'docs/evidence/native-milestone';
const ids = ['96a2d5298e224957bf222245a4fa0a80', 'a48a6ad5659b2fdf4db26645bf0ae8a5'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const get = async path => {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200); return response;
};
mkdirSync(output, { recursive: true });
const html = await (await get('/')).text();
assert.ok(!html.includes('/@vite/client'));
for (const path of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1])) await get(path);
const foreign = await fetch(`${origin}/api/health`, { headers: { Origin: 'https://example.invalid' }, signal: AbortSignal.timeout(10000) });
assert.equal(foreign.status, 403);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const denied = [], errors = [], rooms = [];
await context.route(/\/api\/(?:agents|voice|media|work|mcp)\//, route => {
  denied.push(new URL(route.request().url()).pathname); return route.abort();
});
await context.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => { throw new Error('Physical capture forbidden in this proof.'); };
});
try {
  for (const id of ids) {
    const originalFile = `.data/rooms/${id}.json`, originalBytes = readFileSync(originalFile);
    const original = JSON.parse(originalBytes).state;
    const room = await (await get(`/api/room/${id}`)).json();
    assert.equal(room.room.title, original.title); assert.equal(room.room.objects.length, original.objects.length);
    for (const object of original.objects) {
      const next = room.room.objects.find(item => item.id === object.id); assert.ok(next);
      for (const key of ['id', 'kind', 'x', 'y', 'w', 'h', 'title', 'pinned', 'createdBy', 'createdAt', 'expiresAt']) assert.deepEqual(next[key], object[key]);
      for (const [key, value] of Object.entries(object.data)) assert.deepEqual(next.data[key], value);
    }
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/r/${id}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByRole('button', { name: 'Fit everything', exact: true }).click();
    await page.waitForFunction(expected => document.querySelectorAll('.tl-shape').length >= expected, original.objects.length);
    await page.waitForTimeout(800); // Let the real fit camera animation finish.
    for (const object of original.objects) {
      const shape = page.locator(`.tl-shape[data-shape-id="shape:${object.id}"]`);
      assert.ok(await shape.isVisible());
      if (object.kind === 'image') await shape.locator('img').evaluate(image => {
        if (!image.complete || image.naturalWidth < 1) throw new Error('Preserved image has not decoded.');
      });
    }
    await page.screenshot({ path: `${output}/${id}.png`, fullPage: true });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Fit everything', exact: true }).waitFor();
    const snapshot = (await (await get(`/api/room/${id}/document`)).json()).snapshot;
    const disk = JSON.parse(readFileSync(`.data/tldraw/${id}.json`, 'utf8'));
    const canonical = snapshot.documents.map(item => item.state).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(disk.documents.map(item => item.state).sort((a, b) => a.id.localeCompare(b.id)), canonical);
    assert.ok(readFileSync(originalFile).equals(originalBytes));
    rooms.push({ roomId: id, objects: original.objects.length, originalSha256: hash(originalBytes),
      nativeSha256: hash(JSON.stringify(canonical)), allOriginalFieldsPreserved: true, originalBytesUnchanged: true,
      browserRendered: true, reloadAndDiskMatch: true });
    await page.close();
  }
  assert.deepEqual(denied, []); assert.deepEqual(errors, []);
  writeFileSync(`${output}/summary.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), origin, productionBundle: true, foreignOriginStatus: foreign.status, rooms, deniedRequests: denied, pageErrors: errors }, null, 2)}\n`);
  console.log(JSON.stringify({ productionBundle: true, rooms: rooms.length, originalObjectsPreserved: rooms.reduce((sum, room) => sum + room.objects, 0) }));
} finally { await context.close(); await browser.close(); }

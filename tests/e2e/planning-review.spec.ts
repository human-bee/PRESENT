import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test, expect, type Page } from '@playwright/test';
import { recordsToRoom } from '../../shared/tldraw-adapter';
import type { TLRecord } from 'tldraw';
import type { RoomObject } from '../../shared/room';

async function objects(page: Page, roomId: string): Promise<RoomObject[]> {
  const response = await page.request.get(`/api/room/${roomId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).room.objects;
}
async function openBrief(page: Page) {
  await page.getByRole('button', { name: 'Planning and review', exact: true }).click();
  await page.getByRole('button', { name: 'Open planning brief', exact: true }).click();
}

test('normal planning starter, independent peer correction and reported follow-through survive return and disk', async ({ browser, baseURL }, info) => {
  const roomId = randomBytes(16).toString('hex');
  const contexts = await Promise.all([browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }), browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } })]);
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  let paidRequests = 0;
  const timings: Record<string, number> = {};
  const start = performance.now();
  for (const page of [a, b]) page.on('request', request => { if (/\/api\/(agents\/generate|voice\/|work\/start)/.test(new URL(request.url()).pathname)) paidRequests++; });
  try {
    await Promise.all([a.goto(`/r/${roomId}`), b.goto(`/r/${roomId}`)]);
    await expect(a.locator('.room-status')).toHaveText('here, together');
    await expect(b.locator('.room-status')).toHaveText('here, together');
    const actors = await Promise.all([a, b].map(page => page.evaluate(() => sessionStorage.getItem('present:member-id'))));
    expect(actors[0]).toBeTruthy(); expect(actors[0]).not.toBe(actors[1]);
    await a.getByRole('button', { name: 'Plan and review', exact: true }).click();
    await expect(a.getByRole('region', { name: 'Planning and review' })).toContainText('You decide');
    await expect(a.getByLabel('Keep local review observations')).not.toBeChecked();
    await a.getByLabel('Keep local review observations').check();
    await expect(a.getByLabel('Local review observations', { exact: true })).toContainText('briefs seen 1');
    await a.getByRole('button', { name: 'Open planning brief', exact: true }).click();
    const briefA = a.frameLocator('iframe[title="Planning & review"]');
    const briefB = b.frameLocator('iframe[title="Planning & review"]');
    await expect(briefA.getByLabel('Meeting summary')).toBeVisible();
    await expect(briefB.getByLabel('Meeting summary')).toBeVisible();
    timings.starterVisibleMs = performance.now() - start;
    await briefA.getByLabel('Meeting summary').fill('Review the next public release.');
    await briefA.getByLabel('New decision').fill('Ship only the supported scope.');
    await briefA.getByRole('button', { name: 'Add decision', exact: true }).click();
    await briefA.getByLabel('New action', { exact: true }).fill('Review the landing page.');
    await briefA.getByLabel('New action owner').fill('Operator');
    await briefA.getByRole('button', { name: 'Add action', exact: true }).click();
    await expect(briefB.getByLabel('Action text')).toHaveValue('Review the landing page.');
    await openBrief(b);
    const correctionStart = performance.now();
    await briefB.getByLabel('Action text').fill('Review the landing page and keyboard entry.');
    await expect(briefA.getByLabel('Action text')).toHaveValue('Review the landing page and keyboard entry.');
    timings.peerCorrectionMs = performance.now() - correctionStart;
    await briefB.getByLabel('Action status').selectOption('Done');
    await expect(briefA.getByLabel('Action status')).toHaveValue('Done');
    await a.getByRole('button', { name: 'Planning and review', exact: true }).click();
    await expect(a.getByLabel('Local review observations', { exact: true })).toContainText('text corrections observed 1');
    await expect(a.getByLabel('Local review observations', { exact: true })).toContainText('actions marked Done 1');
    const receipt = await a.evaluate(roomId => JSON.parse(localStorage.getItem(`present:planning-observations:${roomId}`)!), roomId);
    expect(JSON.stringify(receipt)).not.toMatch(/Operator|landing|public|actor|decision:/);
    const canonical = await objects(a, roomId);
    expect(canonical).toHaveLength(3);
    expect(canonical.filter(object => object.data.planningReview === true)).toHaveLength(1);
    expect(canonical.find(object => object.kind === 'timer')?.data.endsAt).toBeNull();
    const directory = process.env.PRESENT_PLANNING_DATA_DIRECTORY;
    if (directory) {
      await expect.poll(() => {
        try {
          const snapshot = JSON.parse(readFileSync(join(directory, 'tldraw', `${roomId}.json`), 'utf8'));
          return recordsToRoom(roomId, snapshot.documents.map((item: { state: TLRecord }) => item.state)).objects;
        } catch { return []; }
      }).toEqual(canonical);
    }
    await a.goto('about:blank');
    await a.goto(`/r/${roomId}`);
    await expect(a.locator('.room-status')).toHaveText('here, together');
    await a.getByRole('button', { name: 'Planning and review', exact: true }).click();
    await expect(a.getByLabel('Local review observations', { exact: true })).toContainText('returns/reloads 1');
    await expect(a.getByLabel('Local review observations', { exact: true })).toContainText('text corrections observed 1');
    const returnReceipt = await a.evaluate(roomId => JSON.parse(localStorage.getItem(`present:planning-observations:${roomId}`)!), roomId);
    await a.getByRole('button', { name: 'Open planning brief', exact: true }).click();
    await expect(briefA.getByLabel('Action text')).toHaveValue('Review the landing page and keyboard entry.');
    expect(await objects(a, roomId)).toEqual(canonical);
    await b.reload();
    await expect(briefB.getByLabel('Action status')).toHaveValue('Done');
    await b.getByRole('button', { name: 'Planning and review', exact: true }).click();
    await expect(b.getByLabel('Keep local review observations')).not.toBeChecked();
    await b.getByRole('button', { name: 'Close planning guide' }).click();
    await a.getByRole('button', { name: 'Planning and review', exact: true }).click();
    await a.getByLabel('Keep local review observations').uncheck();
    expect(await a.evaluate(roomId => localStorage.getItem(`present:planning-observations:${roomId}`), roomId)).toBeNull();
    await a.getByRole('button', { name: 'Close planning guide' }).click();
    await a.screenshot({ path: info.outputPath('planning-review.png') });
    expect(paidRequests).toBe(0);
    const proof = { at: new Date().toISOString(), roomId, runtime: { node: process.version, browser: browser.version() }, contexts: 2, physicalDevices: false, observationOptIn: true, observationContentFree: true, observations: receipt, afterReturn: returnReceipt, canonicalObjects: canonical.length, diskVerified: Boolean(directory), paidRequests, timings: { samples: 1, clock: 'host performance.now; includes browser automation/DOM polling, loopback only', ...timings }, limits: 'A scripted provider-free journey proves controls, shared state and persistence. Done is participant-reported; return includes reload. No actual retention, usefulness or completed-work claim.' };
    writeFileSync(info.outputPath('planning-review.json'), JSON.stringify(proof, null, 2));
    await info.attach('planning-review.json', { path: info.outputPath('planning-review.json'), contentType: 'application/json' });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('portrait touch opens the starter and its honest optional observations without a provider', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const roomId = randomBytes(16).toString('hex');
  let paidRequests = 0;
  page.on('request', request => { if (/\/api\/(agents\/generate|voice\/|work\/start)/.test(new URL(request.url()).pathname)) paidRequests++; });
  try {
    await page.goto(`/r/${roomId}`);
    await page.getByRole('button', { name: 'Plan and review', exact: true }).tap();
    const panel = page.getByRole('region', { name: 'Planning and review' });
    await expect(panel).toBeVisible();
    const checkbox = page.getByLabel('Keep local review observations');
    await checkbox.tap();
    await expect(checkbox).toBeChecked();
    await expect(page.getByLabel('Local review observations', { exact: true })).toContainText('briefs seen 1');
    await page.getByRole('button', { name: 'Open planning brief', exact: true }).tap();
    const summary = page.frameLocator('iframe[title="Planning & review"]').getByLabel('Meeting summary');
    await summary.tap();
    await summary.pressSequentially('Portrait review.');
    await expect(summary).toHaveValue('Portrait review.');
    await expect.poll(async () => (await objects(page, roomId)).find(object => object.data.planningReview === true)?.data.state).toMatchObject({ summary: 'Portrait review.' });
    await page.reload();
    await expect(summary).toHaveValue('Portrait review.');
    await page.getByRole('button', { name: 'Planning and review', exact: true }).tap();
    await expect(page.getByLabel('Local review observations', { exact: true })).toContainText('returns/reloads 1');
    await page.screenshot({ path: info.outputPath('planning-portrait.png') });
    expect(paidRequests).toBe(0);
    expect((await objects(page, roomId)).filter(object => object.data.planningReview === true)).toHaveLength(1);
  } finally { await context.close(); }
});

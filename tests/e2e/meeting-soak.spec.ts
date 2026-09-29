import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { RoomStore } from '../../server/room-store';
import { createAppendTranscript } from '../../server/agents/transcript';
import { makeObject } from '../../shared/room';
import { CAPABILITIES } from '../../shared/capabilities';
import { readTranscriptWindow } from '../../shared/transcript';

test('recorded long meeting: three participants, sprawling history, real widget actions and reconnects', async ({ browser, baseURL }, info) => {
  test.skip(!process.env.PRESENT_SOAK_SECONDS, 'Run the dedicated soak configuration with an explicit duration.');
  const duration = Math.min(3600, Math.max(30, Number(process.env.PRESENT_SOAK_SECONDS))) * 1000;
  test.setTimeout(duration + 180000);
  const roomId = randomBytes(16).toString('hex');
  // Explicit synthetic preloaded history, not simulated microphone/model behavior.
  // This room has not yet been opened by the server, so there is only one writer.
  const fixture = new RoomStore({ directory: join(process.cwd(), '.data/e2e-soak/tldraw') });
  const append = createAppendTranscript(fixture.transactCanvas.bind(fixture));
  const topics = ['launch scope', 'accessibility', 'shared ownership', 'latency', 'customer feedback', 'next steps'];
  for (let i = 0; i < 900; i++) append(roomId, 'synthetic-history', 'soak-fixture', {
    id: `history_${i}`, role: i % 4 === 0 ? 'assistant' : 'user',
    text: `Synthetic meeting turn ${i}: ${topics[i % topics.length]}. ${i % 7 === 0 ? 'Correction: Maya owns this follow-up, not Alex. Keep the existing widget and update its state.' : 'Discuss the trade-off, retain the decision, and do not create a canvas item for ordinary conversation.'}`,
  });
  for (let i = 0; i < 100; i++) {
    const note = makeObject('note', 'synthetic-history', { x: 2000 + i % 10 * 280, y: Math.floor(i / 10) * 220 }, { text: `Discussion ${i}: ${topics[i % topics.length]}` });
    fixture.applyOperation(roomId, { type: 'put', object: { ...note, pinned: true } }, 'synthetic-history');
  }
  const history = readTranscriptWindow(fixture.getCanvasRecords(roomId)); fixture.close();
  expect(history.entries).toHaveLength(500); expect(history.omitted).toBe(400);
  const contexts = await Promise.all(['Maya', 'Alex', 'Observer'].map((name, i) => browser.newContext({ baseURL,
    viewport: { width: 1440, height: 900 }, recordVideo: { dir: info.outputPath(`participant-${i}`), size: { width: 960, height: 600 } },
  }).then(async context => { await context.addInitScript(name => localStorage.setItem('present:name', name), name); return context; })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const videos = pages.map(page => page.video()!);
  const errors: string[] = [], samples: { action: string; participant: number; atMs: number; localMs: number; peerMs: number }[] = [];
  const milestones: { event: string; atMs: number }[] = [];
  const started = performance.now();
  for (const [i, page] of pages.entries()) page.on('pageerror', error => errors.push(`${i}: ${error.message}`));
  const read = async () => (await (await pages[0].request.get(`/api/room/${roomId}`)).json()).room.objects as { id: string; title: string; x: number }[];
  const focus = async (title: string) => {
    const object = (await read()).find(object => object.title === title); expect(object).toBeDefined();
    await Promise.all(pages.map(page => page.goto(`/r/${roomId}?focus=${object!.id}`)));
    for (const page of pages) await expect(page.locator('.room-status')).toHaveText('here, together');
    milestones.push({ event: `Focus ${title}`, atMs: performance.now() - started });
  };
  try {
    await Promise.all(pages.map(page => page.goto(`/r/${roomId}`)));
    for (const page of pages) await expect(page.locator('.room-status')).toHaveText('here, together');
    expect(await pages[0].title()).toContain('PRESENT');
    const labels = ['A thought Native sticky note', 'A moment A shared timer', 'A voice Find your flow', 'A question Vote together', 'A sound Play together', ...CAPABILITIES.map(item => `${item.title} ${item.description}`)];
    for (const [index, label] of labels.entries()) {
      await pages[0].getByRole('button', { name: 'Add to room', exact: true }).click();
      await pages[0].getByRole('button', { name: label, exact: true }).click();
      await expect.poll(async () => (await read()).length).toBe(101 + index);
    }
    const count = (await read()).length;
    await pages[0].getByRole('button', { name: 'Fit everything' }).click();
    await pages[0].screenshot({ path: info.outputPath('sprawling-canvas.png') });
    milestones.push({ event: 'All 13 instruments added beside 100 existing notes', atMs: performance.now() - started });
    const deadline = performance.now() + duration;
    let cycle = 0, lastFocus = '';
    while (performance.now() < deadline) {
      const phase = Math.floor(cycle / 12) % 3, title = ['Shared document', 'Task board', 'Dice table'][phase];
      if (lastFocus !== title) { await focus(title); lastFocus = title; }
      const participant = cycle % 2, peer = 1 - participant;
      const frames = pages.map(page => page.frameLocator(`iframe[title="${title}"]`));
      const before = performance.now();
      if (phase === 0) {
        const text = `Meeting decision ${cycle}: Maya owns ${topics[cycle % topics.length]}. Preserve this correction across all three participants.`;
        const local = frames[participant].getByRole('textbox', { name: 'Document Markdown' });
        await local.fill(text); await local.press('End'); await local.pressSequentially(' Agreed.', { delay: 12 });
        await expect(local).toHaveValue(`${text} Agreed.`);
        const localMs = performance.now() - before;
        for (const other of [peer, 2]) await expect(frames[other].getByRole('textbox', { name: 'Document Markdown' })).toHaveValue(`${text} Agreed.`);
        samples.push({ action: 'document correction + typing', participant, atMs: before - started, localMs, peerMs: performance.now() - before });
      } else if (phase === 1) {
        await frames[participant].locator('#new-task').fill(`Follow-up ${cycle}`);
        await frames[participant].locator('#new-owner').fill('Maya');
        const committed = performance.now();
        await frames[participant].locator('#new-owner').press('Enter');
        await expect(frames[participant].getByLabel('Task title', { exact: true })).toHaveValue(`Follow-up ${cycle}`);
        const localMs = performance.now() - committed;
        await expect(frames[peer].getByLabel('Task title', { exact: true })).toHaveValue(`Follow-up ${cycle}`);
        samples.push({ action: 'add existing-board task', participant, atMs: committed - started, localMs, peerMs: performance.now() - committed });
        await frames[peer].getByLabel('Task status', { exact: true }).selectOption('Done');
        await expect(frames[2].getByLabel('Task status', { exact: true })).toHaveValue('Done');
        await frames[participant].getByRole('button', { name: 'Delete', exact: true }).click();
        for (const frame of frames) await expect(frame.locator('.task')).toHaveCount(0);
      } else {
        if (await frames[participant].locator('details').getAttribute('open') === null) await frames[participant].getByText('Shared roll history', { exact: true }).click();
        await frames[participant].getByRole('button', { name: 'Roll dice', exact: true }).click();
        await expect(frames[participant].locator('#history > div')).toHaveCount(1);
        const localMs = performance.now() - before;
        await expect(frames[peer].locator('#history > div')).toHaveCount(1);
        samples.push({ action: 'shared dice roll', participant, atMs: before - started, localMs, peerMs: performance.now() - before });
        await frames[participant].getByRole('button', { name: 'Remove', exact: true }).click();
        for (const frame of frames) await expect(frame.locator('#history > div')).toHaveCount(0);
      }
      if (cycle % 18 === 0) {
        await pages[2].reload(); await expect(pages[2].locator('.room-status')).toHaveText('here, together');
        milestones.push({ event: 'Observer reload/rejoin', atMs: performance.now() - started });
        await pages[participant].keyboard.press('Escape'); await pages[participant].keyboard.press('ControlOrMeta+k');
        await expect(pages[participant].getByRole('textbox', { name: 'Ask the room' })).toBeFocused();
        await pages[participant].keyboard.press('Escape');
        await pages[participant].getByRole('button', { name: 'Start listening', exact: true }).click({ button: 'right' });
        await expect(pages[participant].locator('.voice-panel')).toContainText('Synthetic meeting turn 899');
        await pages[participant].keyboard.press('Escape');
      }
      if (cycle % 36 === 0) {
        const target = (await read()).find(object => object.title === title)!;
        const header = pages[participant].locator(`.tl-shape[data-shape-id="shape:${target.id}"] [title="Drag to move"]`);
        const box = await header.boundingBox(); expect(box).not.toBeNull();
        await pages[participant].mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await pages[participant].mouse.down();
        await pages[participant].mouse.move(box!.x + box!.width / 2 + 35, box!.y + box!.height / 2 + 20, { steps: 8 });
        await pages[participant].mouse.up();
        await expect.poll(async () => (await read()).find(object => object.id === target.id)?.x).not.toBe(target.x);
        await pages[participant].screenshot({ path: info.outputPath(`review-${cycle}.png`) });
      }
      expect((await read()).length, 'Interactions must reuse widgets, not create new shapes').toBe(count);
      cycle++;
      await pages[0].waitForTimeout(1000); // Real wall-clock soak, not accelerated fake time.
    }
    expect(errors).toEqual([]); expect(samples.length).toBeGreaterThan(10);
    milestones.push({ event: 'Soak complete', atMs: performance.now() - started });
  } finally {
    const percentile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
    const summarize = (key: 'localMs' | 'peerMs') => ({ p50: percentile(samples.map(s => s[key]), .5), p95: percentile(samples.map(s => s[key]), .95), p99: percentile(samples.map(s => s[key]), .99), max: Math.max(0, ...samples.map(s => s[key])), underOneSecond: samples.filter(s => s[key] < 1000).length });
    const evidence = info.outputPath('meeting-soak-evidence.json');
    await writeFile(evidence, JSON.stringify({ boundary: 'Real Chromium UI with synthetic preloaded history. No provider reasoning, real speech, TTS, WAN, or physical audio claim. Three independent contexts on one CI host.', wallClockMs: performance.now() - started, history: { retained: history.entries.length, omitted: history.omitted }, count: samples.length, local: summarize('localMs'), peer: summarize('peerMs'), errors, milestones, samples }, null, 2));
    await info.attach('meeting-soak-evidence', { path: evidence, contentType: 'application/json' });
    await Promise.all(contexts.map(context => context.close()));
    for (const [i, video] of videos.entries()) await info.attach(`participant-${i}-recording`, { path: await video.path(), contentType: 'video/webm' });
  }
});

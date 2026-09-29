import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('60 alternating participant actions retain shared dice history and measure UI latency', async ({ browser, baseURL }, info) => {
  test.setTimeout(60_000);
  const roomId = randomBytes(16).toString('hex');
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const samples: { action: string; participant: number; localMs: number; peerMs: number }[] = [];
  try {
    const openedAt = performance.now();
    await Promise.all(pages.map(page => page.goto(`/r/${roomId}`)));
    for (const page of pages) await expect(page.locator('.room-status')).toHaveText('here, together');
    const bothFreshContextsReadyMs = performance.now() - openedAt;
    await pages[0].getByRole('button', { name: 'Add to room', exact: true }).click();
    await pages[0].getByRole('button', { name: 'Dice table Roll common dice with a shared, attributed history.', exact: true }).click();
    const frames = pages.map(page => page.frameLocator('iframe[title="Dice table"]'));
    for (const frame of frames) await frame.getByText('Shared roll history', { exact: true }).click();
    for (const operation of ['roll', 'remove']) for (let i = 0; i < 30; i++) {
      const participant = i % 2, peer = 1 - participant;
      const count = operation === 'roll' ? i + 1 : 29 - i;
      const start = performance.now();
      if (operation === 'roll') await frames[participant].getByRole('button', { name: 'Roll dice', exact: true }).click();
      else await frames[participant].getByRole('button', { name: 'Remove', exact: true }).first().click();
      await expect(frames[participant].locator('#history > div')).toHaveCount(count);
      const localMs = performance.now() - start;
      await expect(frames[peer].locator('#history > div')).toHaveCount(count);
      samples.push({ action: operation, participant, localMs, peerMs: performance.now() - start });
    }
    await pages[1].reload();
    await expect(pages[1].locator('.room-status')).toHaveText('here, together');
    await expect(frames[1].locator('#latest')).toContainText('Choose your dice and make the first roll.');
    const summarize = (key: 'localMs' | 'peerMs') => {
      const sorted = samples.map(sample => sample[key]).sort((a, b) => a - b);
      return { count: sorted.length, belowOneSecond: sorted.filter(ms => ms < 1000).length,
        p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
    };
    const report = { boundary: 'Real Chromium clicks through local and peer DOM assertions, including Playwright overhead. Two independent browser contexts and a same-host server; no WAN, paint or provider latency claim.', bothFreshContextsReadyMs, local: summarize('localMs'), peer: summarize('peerMs'), samples };
    const path = info.outputPath('widget-action-latency.json');
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
    await info.attach('widget-action-latency', { path, contentType: 'application/json' });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

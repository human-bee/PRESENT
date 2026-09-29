import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { CAPABILITIES } from '../../shared/capabilities';

test('hosted signed room preserves real widget edits over the public WebSocket path', async ({ browser, baseURL }, info) => {
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const [owner, peer] = await Promise.all(contexts.map(context => context.newPage()));
  const samples: { localMs: number; peerMs: number }[] = [], errors: string[] = [];
  for (const page of [owner, peer]) page.on('pageerror', error => errors.push(error.message));
  try {
    expect((await owner.request.get('/healthz')).status()).toBe(200);
    await owner.goto('/');
    await expect(owner.getByTestId('canvas-license-missing'), 'Staging needs VITE_TLDRAW_LICENSE_KEY before hosted UI acceptance can pass.').toHaveCount(0);
    await owner.getByRole('button', { name: 'Create a room', exact: true }).click();
    await expect(owner.locator('.room-status')).toHaveText('here, together');
    const roomURL = owner.url(), roomId = new URL(roomURL).pathname.split('/').pop()!;
    await owner.getByRole('button', { name: 'Invite', exact: true }).click();
    await owner.getByRole('button', { name: 'Create invite', exact: true }).click();
    await peer.goto(await owner.getByLabel('Room link', { exact: true }).inputValue());
    await peer.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(peer.locator('.room-status')).toHaveText('here, together');
    await owner.getByRole('button', { name: 'Close room panel' }).click();
    await owner.getByRole('button', { name: 'Add to room', exact: true }).click();
    const capability = CAPABILITIES.find(item => item.kind === 'document')!;
    await owner.getByRole('button', { name: `${capability.title} ${capability.description}`, exact: true }).click();
    const read = async () => (await (await owner.request.get(`/api/room/${roomId}`)).json()).room.objects;
    await expect.poll(async () => (await read()).some((object: { title: string }) => object.title === 'Shared document')).toBe(true);
    const document = (await read()).find((object: { title: string }) => object.title === 'Shared document');
    expect(document).toBeDefined();
    await peer.goto(`${roomURL}?focus=${document.id}`);
    const pages = [owner, peer], fields = pages.map(page => page.frameLocator('iframe[title="Shared document"]').getByRole('textbox', { name: 'Document Markdown' }));
    for (let i = 0; i < 30; i++) {
      const actor = i % 2, other = 1 - actor, text = `Hosted correction ${i}: update this document, keep one widget.`;
      const before = performance.now();
      await fields[actor].fill(text); await expect(fields[actor]).toHaveValue(text);
      const localMs = performance.now() - before;
      await expect(fields[other]).toHaveValue(text);
      samples.push({ localMs, peerMs: performance.now() - before });
      if (i % 10 === 0) {
        await fields[actor].press('ControlOrMeta+k');
        await expect(pages[actor].getByRole('textbox', { name: 'Ask the room' })).toBeFocused();
        await pages[actor].keyboard.press('Escape');
        await pages[other].reload(); await expect(fields[other]).toHaveValue(text);
      }
    }
    expect((await (await owner.request.get(`/api/room/${roomId}`)).json()).room.objects).toHaveLength(1);
    expect(errors).toEqual([]);
    const percentile = (key: 'localMs' | 'peerMs', fraction: number) => samples.map(sample => sample[key]).sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
    const path = info.outputPath('cloud-timings.json');
    await writeFile(path, JSON.stringify({ boundary: 'Two Chromium contexts on one GitHub runner, actual public HTTPS/WebSocket staging path. No voice/model timing claim.', count: samples.length, localP95: percentile('localMs', .95), peerP95: percentile('peerMs', .95), localMax: percentile('localMs', 1), peerMax: percentile('peerMs', 1), samples }, null, 2));
    await info.attach('cloud-timings', { path, contentType: 'application/json' });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

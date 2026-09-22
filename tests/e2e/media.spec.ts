import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

test.use({ baseURL: process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318' });

type CaptureProof = { calls: number; tracks: MediaStreamTrack[]; peers: RTCPeerConnection[]; roomSockets: WebSocket[] };
type ProofWindow = Window & { __mediaProof: CaptureProof };

async function observeMedia(context: BrowserContext, name: string) {
  await context.addInitScript(({ name }) => {
    localStorage.setItem('present:name', name);
    const proof: CaptureProof = { calls: 0, tracks: [], peers: [], roomSockets: [] };
    (window as unknown as ProofWindow).__mediaProof = proof;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      proof.calls += 1;
      const stream = await capture(constraints);
      proof.tracks.push(...stream.getTracks());
      return stream;
    };
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(Original, {
      construct(target, args) {
        const peer = new target(...args);
        proof.peers.push(peer);
        return peer;
      },
    });
    const OriginalSocket = window.WebSocket;
    window.WebSocket = new Proxy(OriginalSocket, {
      construct(target, args: ConstructorParameters<typeof WebSocket>) {
        const socket = new target(...args);
        const url = new URL(socket.url);
        if (url.pathname === '/connect' && url.searchParams.has('room') && url.searchParams.has('sessionId')) proof.roomSockets.push(socket);
        return socket;
      },
    });
  }, { name });
}

const captureState = (page: Page) => page.evaluate(() => {
  const proof = (window as unknown as ProofWindow).__mediaProof;
  return { calls: proof.calls, tracks: proof.tracks.map(track => ({ kind: track.kind, readyState: track.readyState })), peers: proof.peers.length };
});

async function incomingStats(page: Page) {
  return page.evaluate(async () => {
    const reports = await Promise.all((window as unknown as ProofWindow).__mediaProof.peers.map(peer => peer.getStats()));
    return reports.flatMap(report => [...report.values()].filter(stat => stat.type === 'inbound-rtp').map(stat => ({
      kind: stat.kind, bytesReceived: stat.bytesReceived ?? 0, framesDecoded: stat.framesDecoded ?? 0,
    })));
  });
}

test('joining and using the canvas does not capture any device or start a call', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  await observeMedia(context, 'Quiet visitor');
  const page = await context.newPage();
  const tokens: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/media/token')) tokens.push(request.url()); });
  try {
    await page.goto(`/r/${randomBytes(16).toString('hex')}`);
    await expect(page.locator('.room-status')).toHaveText('here, together');
    await expect(page.locator('.native-canvas .tl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Leave a thought' }).click();
    await page.locator('.tl-note__container').dblclick({ position: { x: 80, y: 70 } });
    await page.locator('.tl-note__container [contenteditable="true"]').fill('A quiet beginning.');
    await page.keyboard.press('Escape');
    await expect(page.locator('.tl-note__container .tl-text-content')).toContainText('A quiet beginning.');
    await page.getByRole('button', { name: "Place Quiet visitor's camera on the canvas" }).click();
    await expect(page.locator('[data-media-capability="participant"]')).toContainText('Join the call to view this tile.');
    await expect(page.getByRole('button', { name: 'Turn microphone on' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
    expect(await captureState(page)).toEqual({ calls: 0, tracks: [], peers: 0 });
    expect(tokens).toEqual([]);
  } finally { await context.close(); }
});

test('two people exchange synthetic LiveKit video and audio, then stop every captured track', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(90_000);
  const room = randomBytes(16).toString('hex');
  const configured = await request.post('/api/media/token', { data: { roomId: room, identity: 'e2e-config-probe', name: 'Test' } });
  const configurationMissing = configured.status() === 503 && (await configured.json()).error === 'Calls are not configured on this server yet.';
  test.skip(configurationMissing, 'LiveKit is not configured on the test server.');
  expect(configured.status()).toBe(200);
  const a = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await Promise.all([observeMedia(a, 'Alex'), observeMedia(b, 'River')]);
  const [alex, river] = await Promise.all([a.newPage(), b.newPage()]);
  try {
    await Promise.all([alex.goto(`/r/${room}`), river.goto(`/r/${room}`)]);
    await expect(alex.locator('.native-canvas .tl-canvas')).toBeVisible();
    await expect(river.locator('.native-canvas .tl-canvas')).toBeVisible();
    await expect(alex.locator('.person-name', { hasText: 'River' })).toBeVisible();
    expect((await captureState(alex)).calls).toBe(0);
    expect((await captureState(river)).calls).toBe(0);
    await alex.getByRole('button', { name: 'Turn camera on' }).click();
    await river.getByRole('button', { name: 'Turn camera on' }).click();
    await expect(alex.getByRole('button', { name: 'Turn camera off' })).toBeVisible({ timeout: 30_000 });
    await expect(river.getByRole('button', { name: 'Turn camera off' })).toBeVisible({ timeout: 30_000 });
    await alex.getByRole('button', { name: 'Turn microphone on' }).click();
    await river.getByRole('button', { name: 'Turn microphone on' }).click();
    await expect(alex.locator('.person video')).toHaveCount(2, { timeout: 30_000 });
    await expect(river.locator('.person video')).toHaveCount(2, { timeout: 30_000 });
    await alex.getByRole('button', { name: "Place Alex's camera on the canvas" }).click();
    await alex.getByRole('button', { name: "Place River's camera on the canvas" }).click();
    for (const page of [alex, river]) {
      await expect(page.locator('[data-media-capability="participant"] video')).toHaveCount(2);
      await expect.poll(async () => (await incomingStats(page)).some(s => s.kind === 'video' && s.framesDecoded > 10), { timeout: 30_000 }).toBe(true);
      await expect.poll(async () => (await incomingStats(page)).some(s => s.kind === 'audio' && s.bytesReceived > 1000), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => page.locator('.person video, [data-media-capability="participant"] video').evaluateAll(elements => elements.every(element => (element as HTMLVideoElement).videoWidth > 0))).toBe(true);
    }
    // Interrupt only the native tldraw transport; the real LiveKit call stays live.
    const socketsBefore = await alex.evaluate(() => (window as unknown as ProofWindow).__mediaProof.roomSockets.length);
    expect(socketsBefore).toBeGreaterThan(0);
    const framesBefore = (await incomingStats(alex)).reduce((sum, stat) => sum + stat.framesDecoded, 0);
    await alex.evaluate(() => (window as unknown as ProofWindow).__mediaProof.roomSockets.at(-1)?.close());
    await expect.poll(() => alex.evaluate(() => (window as unknown as ProofWindow).__mediaProof.roomSockets.length)).toBeGreaterThan(socketsBefore);
    await expect(alex.locator('.room-status')).toHaveText('here, together');
    await expect(alex.locator('.person video')).toHaveCount(2);
    await expect(river.locator('.person video')).toHaveCount(2);
    await expect(alex.locator('[data-media-capability="participant"] video')).toHaveCount(2);
    await expect(river.locator('[data-media-capability="participant"] video')).toHaveCount(2);
    await expect.poll(async () => (await incomingStats(alex)).reduce((sum, stat) => sum + stat.framesDecoded, 0)).toBeGreaterThan(framesBefore);
    expect((await captureState(alex)).calls).toBe(2);
    expect((await captureState(alex)).tracks.every(track => track.readyState === 'live')).toBe(true);
    await alex.screenshot({ path: info.outputPath('livekit-two-way-fake-media.png') });
    const statsPath = info.outputPath('real-webrtc-stats.json');
    await writeFile(statsPath, JSON.stringify({ alex: await incomingStats(alex), river: await incomingStats(river) }, null, 2));
    await info.attach('real-webrtc-stats', { path: statsPath, contentType: 'application/json' });
    for (const page of [alex, river]) {
      await page.getByRole('button', { name: 'Turn camera off' }).click();
      await page.getByRole('button', { name: 'Turn microphone off' }).click();
      await expect(page.getByRole('button', { name: 'Turn microphone on' })).toBeVisible();
      await expect.poll(async () => (await captureState(page)).tracks.every(track => track.readyState === 'ended')).toBe(true);
      expect((await captureState(page)).tracks.map(track => track.kind).sort()).toEqual(['audio', 'video']);
    }
    await expect(alex.locator('.person video')).toHaveCount(0);
    await expect(river.locator('.person video')).toHaveCount(0);
    await expect(alex.locator('[data-media-capability="participant"] video')).toHaveCount(0);
    await expect(river.locator('[data-media-capability="participant"] video')).toHaveCount(0);
    await expect(alex.locator('[data-media-capability="participant"] [role="status"]')).toHaveText(['Camera is off or unavailable.', 'Camera is off or unavailable.']);
  } finally { await Promise.all([a.close(), b.close()]); }
});

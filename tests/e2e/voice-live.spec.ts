import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

type VoiceProof = {
  startedAt: number;
  tracks: MediaStreamTrack[];
  events: { type: string; elapsedMs: number; status?: string }[];
  providerModel?: string;
};
type ProofWindow = Window & { __voiceProof: VoiceProof };
const command = 'Present, add a note saying the dragon likes tea';
const expectedWords = /dragon likes tea/i;

test.use({ baseURL: process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318' });
test.describe.configure({ retries: 0 });
test('real Realtime speech creates a native note from a synthetic microphone', async ({ baseURL }, info) => {
  test.skip(process.env.LIVE_VOICE !== '1', 'Opt in with LIVE_VOICE=1; this test makes a real paid Realtime call.');
  test.setTimeout(100_000);
  const evidence = resolve('docs/evidence');
  await mkdir(evidence, { recursive: true });
  const aiff = info.outputPath('voice-speech.aiff');
  const wav = info.outputPath('voice-input.wav');
  // An 85-second file cannot repeat the command within the 80-second safety limit.
  execFileSync('/usr/bin/say', ['-r', '155', '-o', aiff, command], { timeout: 15_000 });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff,
    '-af', 'adelay=3000:all=1,apad', '-t', '85', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 15_000 });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required',
  ] });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const roomId = randomBytes(16).toString('hex');
  const report: Record<string, unknown> = {
    at: new Date().toISOString(), roomId, command, browser: 'headless Google Chrome',
    input: { synthetic: true, generator: 'macOS say → ffmpeg', initialSilenceMs: 3000, sampleRate: 48000, channels: 1 },
    provider: 'OpenAI Realtime', mockedModelResponses: false, outcome: 'failed',
  };
  await context.addInitScript(() => {
    localStorage.setItem('present:name', 'Synthetic voice proof');
    const proof: VoiceProof = { startedAt: 0, tracks: [], events: [] };
    (window as unknown as ProofWindow).__voiceProof = proof;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints);
      proof.tracks.push(...stream.getTracks());
      return stream;
    };
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(Original, {
      construct(target, args) {
        const peer = new target(...args);
        const createChannel = peer.createDataChannel.bind(peer);
        peer.createDataChannel = (label, options) => {
          const channel = createChannel(label, options);
          channel.addEventListener('message', message => {
            try {
              const event = JSON.parse(String(message.data));
              if (typeof event.type !== 'string') return;
              proof.events.push({ type: event.type, elapsedMs: Math.round(performance.now() - proof.startedAt), status: event.response?.status });
              if (event.type === 'session.created') proof.providerModel = event.session?.model;
            } catch { /* Ignore non-JSON packets; never alter a provider response. */ }
          });
          return channel;
        };
        return peer;
      },
    });
  });
  const page = await context.newPage();
  let startedAt = 0;
  let failure: unknown;
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  const requests: { route: string; status: number; elapsedMs: number; tool?: string }[] = [];
  page.on('response', response => {
    const route = new URL(response.url()).pathname;
    if (!route.startsWith('/api/voice/')) return;
    let tool: string | undefined;
    if (route === '/api/voice/tool') {
      try { tool = response.request().postDataJSON()?.name; } catch { /* No payloads or SDP in evidence. */ }
    }
    requests.push({ route, status: response.status(), elapsedMs: Date.now() - startedAt, tool });
  });
  try {
    await page.goto(`/r/${roomId}`);
    await expect(page.locator('.room-status')).toHaveText('here, together');
    await expect(page.locator('.native-canvas .tl-canvas')).toBeVisible();
    await expect(page.locator('.tl-note__container')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as ProofWindow).__voiceProof.tracks.length)).toBe(0);
    const sessionResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/voice/session', { timeout: 25_000 });
    startedAt = Date.now();
    await page.evaluate(() => { (window as unknown as ProofWindow).__voiceProof.startedAt = performance.now(); });
    safetyTimer = setTimeout(() => { void browser.close(); }, 80_000);
    await page.getByRole('button', { name: 'Start listening', exact: true }).click();
    expect((await sessionResponse).status()).toBe(200);
    report.sessionResponseMs = Date.now() - startedAt;
    await page.getByRole('button', { name: 'Show voice transcript' }).click();
    await page.waitForFunction(() => {
      const notes = [...document.querySelectorAll('.tl-note__container .tl-text-content')];
      const transcript = document.querySelector('.voice-transcript')?.textContent || '';
      return !!document.querySelector('.voice-error') ||
        (notes.some(note => /dragon likes tea/i.test(note.textContent || '')) && /dragon likes tea/i.test(transcript));
    }, undefined, { timeout: 40_000 });
    report.noteAndTranscriptVisibleMs = Date.now() - startedAt;
    await expect(page.locator('.voice-error')).toHaveCount(0);
    await expect(page.locator('.voice-transcript')).toContainText(expectedWords);
    await expect(page.locator('.tl-note__container .tl-text-content')).toContainText(expectedWords);
    expect(requests.some(request => request.route === '/api/voice/tool' && request.tool === 'add_note' && request.status === 200)).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProofWindow).__voiceProof.events.some(event => event.type === 'response.done')), { timeout: 5000 }).toBe(true);
    report.outcome = 'passed';
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    failure = error;
  } finally {
    try {
      if (!page.isClosed()) {
        try {
          report.transcript = await page.locator('.voice-transcript').innerText({ timeout: 2000 }).catch(() => 'Transcript panel unavailable');
          report.notes = await page.locator('.tl-note__container .tl-text-content').allTextContents();
          report.realtime = await page.evaluate(() => {
            const { events, providerModel } = (window as unknown as ProofWindow).__voiceProof;
            return { events, providerModel };
          });
          await page.screenshot({ path: resolve(evidence, 'voice-live.png'), timeout: 5000 });
        } finally {
          const stop = page.getByRole('button', { name: 'Stop listening', exact: true });
          if (await stop.isVisible()) await stop.click({ timeout: 3000 });
          await expect(page.getByRole('button', { name: 'Start listening', exact: true })).toBeVisible({ timeout: 3000 });
          await expect.poll(() => page.evaluate(() => (window as unknown as ProofWindow).__voiceProof.tracks.every(track => track.readyState === 'ended')), { timeout: 3000 }).toBe(true);
          report.capturedTracksEnded = true;
          report.listeningStoppedMs = Date.now() - startedAt;
        }
      }
    } catch (error) {
      report.outcome = 'failed';
      report.cleanupError = error instanceof Error ? error.message : String(error);
      failure ??= error;
    } finally {
      clearTimeout(safetyTimer);
      await browser.close();
      report.ownBrowserClosed = true;
      report.requests = requests;
      const body = JSON.stringify(report, null, 2);
      await writeFile(resolve(evidence, 'voice-live.json'), `${body}\n`);
      await info.attach('real-voice-proof', { body, contentType: 'application/json' });
    }
  }
  if (failure) throw failure;
});

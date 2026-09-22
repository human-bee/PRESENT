import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';

// This records actual local app interactions in fresh isolated browsers. Chrome's
// synthetic sources ensure it never activates the user's physical camera or mic.
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4317';
const output = resolve('docs/evidence');
const frames = join(output, 'recording-frames');
await mkdir(frames, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const peerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem('present:name', 'Alex'));
await peerContext.addInitScript(() => localStorage.setItem('present:name', 'River'));
const [page, peer] = await Promise.all([context.newPage(), peerContext.newPage()]);
const roomId = randomBytes(16).toString('hex');
const roomURL = `${baseURL}/r/${roomId}`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let recording = true;
let record: Promise<void> | undefined;

async function move(page: Page, kind: string, dx: number, dy: number) {
  const bounds = await page.locator(`.object-${kind} .object-handle`).boundingBox();
  if (!bounds) throw new Error('Object handle missing');
  await page.mouse.move(bounds.x + 85, bounds.y + 14);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 85 + dx, bounds.y + 14 + dy, { steps: 18 });
  await page.mouse.up();
}

try {
  await Promise.all([page.goto(roomURL), peer.goto(roomURL)]);
  await expect(page.locator('.person-name', { hasText: 'River' })).toBeVisible();
  await page.screenshot({ path: join(output, 'desktop-empty.png') });
  const started = Date.now();
  record = (async () => {
    let index = 0;
    while (recording) {
      const tick = Date.now();
      await page.screenshot({ path: join(frames, `${String(index++).padStart(5, '0')}.png`) });
      await pause(Math.max(0, 200 - (Date.now() - tick)));
    }
  })();
  await pause(1200);
  await page.getByRole('textbox', { name: 'Room name' }).fill('The gathering');
  await page.getByRole('textbox', { name: 'Room name' }).press('Enter');
  await page.getByRole('button', { name: 'Leave a thought' }).click();
  await page.getByRole('textbox', { name: 'Note text' }).pressSequentially('A place for people, agents, and the things we make together.', { delay: 25 });
  await expect(peer.getByRole('textbox', { name: 'Note text' })).toHaveValue('A place for people, agents, and the things we make together.');
  await move(page, 'note', -330, -130);
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  await page.getByRole('button', { name: 'A moment Make a little time' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await move(page, 'timer', 280, -100);
  await pause(1000);
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  await page.getByRole('button', { name: 'A chance Let the dice decide' }).click();
  await page.frameLocator('iframe[title="A little chance"]').getByRole('button', { name: 'Roll the dice' }).click();
  await move(page, 'widget', -120, 130);
  await page.getByRole('button', { name: 'Fit everything' }).click();
  await peer.getByRole('button', { name: 'Fit everything' }).click();
  await pause(700);
  await peer.frameLocator('iframe[title="A little chance"]').getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.frameLocator('iframe[title="A little chance"]').locator('#rolls')).toHaveText('Roll 2');
  const mediaResponse = await page.request.post(`${baseURL}/api/media/token`, { data: { roomId, identity: 'recording-probe', name: 'Test' } });
  const mediaConfigured = mediaResponse.ok();
  if (mediaConfigured) {
    await page.getByRole('button', { name: 'Turn camera on' }).click();
    await peer.getByRole('button', { name: 'Turn camera on' }).click();
    await expect(page.locator('.person video')).toHaveCount(2, { timeout: 30_000 });
    await expect.poll(() => page.locator('.person video').evaluateAll(videos => videos.every(video => (video as HTMLVideoElement).videoWidth > 0))).toBe(true);
    await page.getByRole('button', { name: 'Turn microphone on' }).click();
    await peer.getByRole('button', { name: 'Turn microphone on' }).click();
  }
  await peer.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await pause(1200);
  await page.screenshot({ path: join(output, 'desktop-shared-room.png') });
  await pause(Math.max(0, 22_000 - (Date.now() - started)));
  recording = false;
  await record;
  if (mediaConfigured) {
    for (const person of [page, peer]) {
      const cameraOff = person.getByRole('button', { name: 'Turn camera off' });
      const microphoneOff = person.getByRole('button', { name: 'Turn microphone off' });
      if (await cameraOff.isVisible()) await cameraOff.click();
      if (await microphoneOff.isVisible()) await microphoneOff.click();
      await expect(person.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
      await expect(person.getByRole('button', { name: 'Turn microphone on' })).toBeVisible();
    }
    await expect(page.locator('.person video')).toHaveCount(0);
    await expect(page.locator('.person.has-video')).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit everything' }).click();
  await page.screenshot({ path: join(output, 'mobile-shared-room.png') });
  await writeFile(join(output, 'browser-proof.json'), JSON.stringify({ capturedAt: new Date().toISOString(), roomURL,
    viewport: { desktop: '1440x900', mobile: '390x844' }, mediaConfigured, syntheticMediaOnly: true,
    evidence: ['shared note typing and dragging', 'timer start and peer pause', 'dice rolled by each participant', 'desktop and mobile fit'],
  }, null, 2));
  await new Promise<void>((resolve, reject) => {
    const encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frames, '%05d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', join(output, 'shared-room-demo.mp4')], { stdio: 'inherit' });
    encoder.on('error', reject);
    encoder.on('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  await rm(frames, { recursive: true });
  console.log(`Saved screenshots and real interaction recording to ${output}`);
} finally {
  recording = false;
  try { await record; }
  finally { await browser.close(); }
}

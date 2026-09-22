import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { installTimerProbe } from './browser-timer.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function launch(output) {
  const require = createRequire(import.meta.url);
  const metadata = JSON.parse(readFileSync(resolve(dirname(require.resolve('playwright-core')), 'browsers.json'), 'utf8'));
  const directory = resolve(output, 'runtime', `ffmpeg-${metadata.browsers.find(item => item.name === 'ffmpeg').revision}`);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(resolve(directory, 'ffmpeg-mac'))) symlinkSync('/opt/homebrew/bin/ffmpeg', resolve(directory, 'ffmpeg-mac'));
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(output, 'runtime');
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
}
export async function openParticipant(browser, target, trial, output, name) {
  const context = await browser.newContext({ baseURL: target.url, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', recordVideo: { dir: resolve(output, 'videos'), size: { width: 1440, height: 900 } } });
  await context.addInitScript(value => { localStorage.setItem('present:name', value); localStorage.setItem('present:display_name', value); }, name);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    const allowedApi = route.request().method() === 'GET' && ['/api/health', `/api/room/${trial.room}`].includes(url.pathname)
      || target.name === 'new' && route.request().method() === 'POST' && url.pathname === `/api/room/${trial.room}/operation`;
    if (['127.0.0.1', 'localhost'].includes(url.hostname) && [new URL(target.url).port, '4321'].includes(url.port) && (!url.pathname.startsWith('/api/') || allowedApi)) return route.continue();
    if (['blob:', 'data:'].includes(url.protocol)) return route.continue();
    trial.blockedRequests.push({ participant: name, origin: url.origin, pathname: url.pathname }); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const pending = [];
  page.on('pageerror', error => trial.errors.push({ participant: name, error: error.message }));
  page.on('response', response => {
    if (response.request().resourceType() === 'script') pending.push((async () => {
      try { const body = await response.body(); trial.loadedScripts.push({ participant: name, url: response.url(), status: response.status(), bytes: body.length, hash: hash(body) }); }
      catch (error) { trial.loadedScripts.push({ participant: name, url: response.url(), error: error.message }); }
    })());
  });
  const path = target.name === 'old' ? `/canvas?id=dev-${trial.room}&room=canvas-dev-${trial.room}` : `/r/${trial.room}`;
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__presentEditor ?? window.__present?.tldrawEditor ?? window.editor), null, { timeout: 45000 });
  if (target.name === 'old') await page.waitForFunction(() => typeof window.__presentToolDispatcherExecute === 'function');
  await page.evaluate(installTimerProbe, { target: target.name, objectId: trial.objectId });
  return { page, context, pending, name, async close() { const video = page.video(); await context.close(); await Promise.allSettled(pending); return { participant: name, file: await video.path() }; } };
}

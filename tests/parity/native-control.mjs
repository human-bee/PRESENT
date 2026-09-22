import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { installProbe } from './browser-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.env.PARITY_OUTPUT ?? 'docs/evidence/parity-control');
const trials = Number(process.env.PARITY_TRIALS ?? 5);
const startIndex = Number(process.env.PARITY_START_INDEX ?? 0);
if (!Number.isInteger(trials) || trials < 1 || !Number.isInteger(startIndex) || startIndex < 0 || startIndex + trials > 5) throw new Error('Initial control smoke is bounded to five total indexed trials per implementation.');
const targets = [
  { name: 'old', baseURL: process.env.PARITY_OLD_URL ?? 'http://127.0.0.1:4320', root: process.env.PARITY_OLD_ROOT ?? '/Users/bsteinher/.codex/worktrees/present-room-zero-friction-clean' },
  { name: 'new', baseURL: process.env.PARITY_NEW_URL ?? 'http://127.0.0.1:4318', root },
].filter(target => !process.env.PARITY_ONLY || target.name === process.env.PARITY_ONLY);
mkdirSync(output, { recursive: true });
// Reuse the installed system encoder through a private Playwright cache; no browser/binary install.
const require = createRequire(import.meta.url);
const metadata = JSON.parse(readFileSync(resolve(dirname(require.resolve('playwright-core')), 'browsers.json'), 'utf8'));
const encoderRevision = metadata.browsers.find(item => item.name === 'ffmpeg').revision;
const encoderDirectory = resolve(output, 'runtime', `ffmpeg-${encoderRevision}`);
mkdirSync(encoderDirectory, { recursive: true });
const encoderPath = resolve(encoderDirectory, 'ffmpeg-mac');
const systemEncoder = '/opt/homebrew/bin/ffmpeg';
if (!existsSync(encoderPath)) symlinkSync(systemEncoder, encoderPath);
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(output, 'runtime');
const { chromium } = await import('@playwright/test');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceManifest = target => {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: target.root, encoding: 'utf8' }).split('\0')
    .filter(path => /^(src\/|server\/|shared\/|packages\/|services\/|scripts\/tldraw-sync-server\/|package.*\.json$|vite\.config\.|next\.config\.)/.test(path) && existsSync(resolve(target.root, path))).sort();
  const files = Object.fromEntries(paths.map(path => [path, hash(readFileSync(resolve(target.root, path)))]));
  return { hash: hash(JSON.stringify(files)), files };
};
const manifest = {
  startedAt: new Date().toISOString(), classification: 'Browser-control/native-editor/local-network-sync smoke; no voice, model, provider, or LiveKit measurement.',
  timing: 'input_commit immediately before Editor.createShapes; animation-frame observer requires rendered nonzero on-screen shape bounds; usable requires both correct native shapes and initiating selection; peer timing requires identical canonical target-shape hash.',
  trialCountPerTarget: trials, startIndex, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  encoder: execFileSync(systemEncoder, ['-version'], { encoding: 'utf8' }).split('\n')[0],
  machine: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpus: os.cpus().length, memoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), loadAverage: os.loadavg() },
  driverHashes: Object.fromEntries(['native-control.mjs', 'browser-probe.mjs', 'old-services.mjs', 'loopback-only.cjs'].map(name => [name, hash(readFileSync(resolve(root, 'tests/parity', name)))])),
  targets: targets.map(target => ({ ...target, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target.root, encoding: 'utf8' }).trim(), trackedDiffHash: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: target.root })), packageLockHash: hash(readFileSync(resolve(target.root, 'package-lock.json'))) })),
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
manifest.browser = browser.version();
const results = [];
try {
  for (const target of targets) {
    const source = sourceManifest(target);
    writeFileSync(resolve(output, `source-${target.name}.json`), `${JSON.stringify(source, null, 2)}\n`);
    manifest.targets.find(item => item.name === target.name).sourceHash = source.hash;
  }
  for (let index = startIndex; index < startIndex + trials; index += 1) {
    for (const target of index % 2 ? [...targets].reverse() : targets) {
      const room = randomBytes(16).toString('hex');
      const requestId = `parity-${randomBytes(10).toString('hex')}`;
      const trial = { target: target.name, index, room, requestId, status: 'failed', phase: 'bootstrap', timeoutMs: 5000, startedAt: new Date().toISOString(), loadAverage: os.loadavg(), blockedRequests: [], errors: [] };
      const contexts = [];
      try {
        for (const name of ['Initiator', 'Peer']) {
          const context = await browser.newContext({ baseURL: target.baseURL, viewport: manifest.viewport, deviceScaleFactor: 1, serviceWorkers: 'block', recordVideo: { dir: resolve(output, 'videos'), size: manifest.viewport } });
          contexts.push(context);
          await context.addInitScript(value => { localStorage.setItem('present:name', value); localStorage.setItem('present:display_name', value); }, name);
          await context.route('**/*', route => {
            const url = new URL(route.request().url());
            const allowedApi = route.request().method() === 'GET' && ['/api/health', `/api/room/${room}`].includes(url.pathname);
            if (['127.0.0.1', 'localhost'].includes(url.hostname) && [new URL(target.baseURL).port, '4321'].includes(url.port)
              && (!url.pathname.startsWith('/api/') || allowedApi)) return route.continue();
            if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
            trial.blockedRequests.push({ origin: url.origin, pathname: url.pathname });
            return route.abort('blockedbyclient');
          });
        }
        const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
        for (const page of [a, b]) {
          page.setDefaultTimeout(10_000);
          page.on('pageerror', error => trial.errors.push(error.message));
        }
        const path = target.name === 'old' ? `/canvas?id=dev-${room}&room=canvas-dev-${room}` : `/r/${room}`;
        await Promise.all([a.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }), b.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 })]);
        for (const page of [a, b]) {
          await page.waitForFunction(() => Boolean(window.__presentEditor ?? window.__present?.tldrawEditor ?? window.editor), null, { timeout: 45_000 });
          await page.evaluate(installProbe);
        }
        await a.evaluate(id => window.__parity.seed(id), requestId);
        await Promise.all([a, b].map(page => page.waitForFunction(id => window.__parity.seedReady(id), requestId, { timeout: 10_000 })));
        trial.phase = 'scenario';
        await b.evaluate(id => window.__parity.arm(id, false), requestId);
        await a.evaluate(id => { window.__parity.arm(id, true); window.__parity.commit(id); }, requestId);
        await Promise.all([a, b].map(page => page.waitForFunction(id => window.__parity.marks[id].done, requestId, { timeout: 6500 })));
        const [initiator, peer] = await Promise.all([a, b].map(page => page.evaluate(id => window.__parity.marks[id], requestId)));
        trial.initiator = initiator;
        trial.peer = peer;
        const first = initiator.inputCommit.epochMs;
        trial.initiatorHash = hash(initiator.stateJson ?? '');
        trial.peerHash = hash(peer.stateJson ?? '');
        trial.status = !initiator.error && !peer.error && trial.initiatorHash === trial.peerHash ? 'passed' : 'failed';
        trial.metrics = {
          firstVisibleMs: initiator.firstVisible ? initiator.firstVisible.epochMs - first : 5000,
          usableMs: initiator.usable ? initiator.usable.epochMs - first : 5000,
          peerConvergedMs: trial.status === 'passed' ? peer.usable.epochMs - first : 5000,
          browserAppliedMs: initiator.browserApplied.epochMs - first,
        };
        try {
          await Promise.all([a.screenshot({ path: resolve(output, `${target.name}-${index}-initiator.png`), timeout: 30_000 }), b.screenshot({ path: resolve(output, `${target.name}-${index}-peer.png`), timeout: 30_000 })]);
          trial.evidenceStatus = 'captured';
        } catch (error) { trial.evidenceStatus = 'failed'; trial.evidenceError = error.message; }
      } catch (error) {
        trial.status = 'failed';
        trial.error = error.message;
        trial.metrics = trial.phase === 'scenario' ? { firstVisibleMs: 5000, usableMs: 5000, peerConvergedMs: 5000 } : null;
        const page = contexts[0]?.pages()[0];
        if (page) { trial.body = (await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')).slice(0, 4000); await page.screenshot({ path: resolve(output, `${target.name}-${index}-failed.png`), timeout: 5000 }).catch(() => {}); }
      } finally { await Promise.all(contexts.map(context => context.close())); }
      results.push(trial);
      writeFileSync(resolve(output, 'results.json'), `${JSON.stringify({ manifest, results }, null, 2)}\n`);
      console.log(JSON.stringify({ target: trial.target, index, status: trial.status, metrics: trial.metrics, error: trial.error }));
      if (trial.error) throw new Error(`${target.name} setup failed; stopped the bounded suite: ${trial.error}`);
    }
  }
} finally {
  manifest.completedAt = new Date().toISOString();
  for (const target of targets) {
    const result = manifest.targets.find(item => item.name === target.name);
    result.endingSourceHash = sourceManifest(target).hash;
    result.sourceChangedDuringRun = result.sourceHash !== result.endingSourceHash;
  }
  writeFileSync(resolve(output, 'results.json'), `${JSON.stringify({ manifest, results }, null, 2)}\n`);
  await browser.close();
}

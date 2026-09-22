import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { launch, hash } from './timer-fixture.mjs';
import { runTimerTrial } from './timer-repeat-trial.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.env.PARITY_OUTPUT ?? 'docs/evidence/parity-timer-repeat');
if (existsSync(resolve(output, 'results.json'))) throw new Error('Use a new evidence directory; never overwrite an earlier run.');
const count = Number(process.env.PARITY_TRIALS ?? 5);
const startIndex = Number(process.env.PARITY_START_INDEX ?? 0);
if (!Number.isInteger(count) || !Number.isInteger(startIndex) || count < 1 || startIndex < 0 || startIndex + count > 5) throw new Error('Bounded to five indexed trials per target.');
mkdirSync(output, { recursive: true });
const targets = [
  { name: 'old', storageRoot: resolve(root, process.env.PARITY_OLD_STORAGE_ROOT ?? 'docs/evidence/parity-old-bootstrap/.tldraw-local/rooms'), url: 'http://127.0.0.1:4320', root: '/Users/bsteinher/.codex/worktrees/present-parity-old-bootstrap', setup: 'Old repaired build; client create_component; explicit untimed pointer resize to expose clock/controls.' },
  { name: 'new', url: 'http://127.0.0.1:4318', root, setup: 'Default 280x230 native timer created by room operation REST. No voice session.' },
].filter(target => !process.env.PARITY_ONLY || target.name === process.env.PARITY_ONLY);
const sourceManifest = target => {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: target.root, encoding: 'utf8' }).split('\0').filter(path => /^(src\/|server\/|shared\/|package.*\.json$)/.test(path) && existsSync(resolve(target.root, path))).sort();
  const files = Object.fromEntries(paths.map(path => [path, hash(readFileSync(resolve(target.root, path)))]));
  return { hash: hash(JSON.stringify(files)), files };
};
const sources = Object.fromEntries(targets.map(target => [target.name, sourceManifest(target)]));
for (const [target, source] of Object.entries(sources)) writeFileSync(resolve(output, `source-${target}.json`), `${JSON.stringify(source, null, 2)}\n`);
const drivers = ['timer-repeat.mjs', 'timer-repeat-trial.mjs', 'timer-fixture.mjs', 'browser-timer.mjs'];
const driverHashes = Object.fromEntries(drivers.map(path => {
  const content = readFileSync(resolve(root, 'tests/parity', path)); writeFileSync(resolve(output, path), content); return [path, hash(content)];
}));
const manifest = { startedAt: new Date().toISOString(), classification: 'Five interleaved native timer UI control pairs after untimed usable setup. No model, speech, media-device or server-restart measurement.', countPerTarget: count, startIndex,
  targets: targets.map(target => ({ ...target, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target.root, encoding: 'utf8' }).trim(), trackedDiffHash: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: target.root })), sourceHash: sources[target.name].hash })), driverHashes,
  timing: 'Actual button pointerdown handler -> RAF with visible clock, displayed time consistent with native state, visible enabled active control and exact expected running/duration state; peer must satisfy the same condition and equal canonical native state hash.',
  limits: 'Median and observed range only. Creation/old human resize are excluded. Paused whole-shape hashes include real saved JSON and fresh browser, not server-restart recovery.',
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
};
const browser = await launch(output); manifest.browser = browser.version();
const results = [];
const save = () => writeFileSync(resolve(output, 'results.json'), `${JSON.stringify({ manifest, results }, null, 2)}\n`);
try {
  for (let index = startIndex; index < startIndex + count; index += 1) for (const target of index % 2 ? [...targets].reverse() : targets) {
    const trial = { target: target.name, index, room: randomBytes(16).toString('hex'), objectId: `timer-${randomBytes(8).toString('hex')}`, startedAt: new Date().toISOString(), loadAverage: os.loadavg(), status: 'failed', steps: [], errors: [], blockedRequests: [], loadedScripts: [], videos: [] };
    results.push(trial); save();
    await runTimerTrial({ browser, target, trial, output, root, save });
    console.log(JSON.stringify({ target: trial.target, index, status: trial.status, geometry: trial.setup?.geometry, shapeHashesMatch: trial.shapeHashesMatch, error: trial.error }));
    if (trial.error) throw new Error(`${target.name} trial ${index} failed; stopped bounded suite without omitting the failure.`);
  }
} finally {
  manifest.completedAt = new Date().toISOString();
  for (const target of targets) { const source = sourceManifest(target); writeFileSync(resolve(output, `source-${target.name}-ending.json`), `${JSON.stringify(source, null, 2)}\n`); const entry = manifest.targets.find(item => item.name === target.name); entry.endingSourceHash = source.hash; entry.sourceChangedDuringRun = entry.sourceHash !== source.hash; }
  save(); await browser.close();
}

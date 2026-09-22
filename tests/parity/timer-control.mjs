import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { launch, openParticipant, hash } from './timer-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.env.PARITY_OUTPUT ?? 'docs/evidence/parity-timer-control');
mkdirSync(output, { recursive: true });
const targets = [
  { name: 'old', url: 'http://127.0.0.1:4320', root: '/Users/bsteinher/.codex/worktrees/present-parity-old-bootstrap', entry: 'client create_component dispatcher; UI timer controls; client update_component dispatcher' },
  { name: 'new', url: 'http://127.0.0.1:4318', root, entry: 'POST room operation; UI timer controls; POST room patch operation (voice endpoint requires an active Realtime listener)' },
].filter(target => !process.env.PARITY_ONLY || target.name === process.env.PARITY_ONLY);
const manifest = { startedAt: new Date().toISOString(), classification: 'One paired native timer/shared-state/browser-reload control. No model, speech, LiveKit, media device, server restart, or full voice-ingress measurement.',
  targets: targets.map(target => ({ ...target, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target.root, encoding: 'utf8' }).trim(), trackedDiffHash: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: target.root })) })),
  driverHashes: Object.fromEntries(['timer-control.mjs', 'timer-fixture.mjs', 'browser-timer.mjs'].map(path => [path, hash(readFileSync(resolve(root, 'tests/parity', path)))])),
  timing: 'Browser epoch clock immediately before dispatcher/REST request, or pointerdown event on real UI control. RAF observes visible time text, usable control, and expected native state. Single samples only; running states may tick between observers.',
};
const browser = await launch(output); manifest.browser = browser.version();
const results = [];
const save = () => writeFileSync(resolve(output, 'results.json'), `${JSON.stringify({ manifest, results }, null, 2)}\n`);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
try {
  for (const target of targets) {
    const trial = { target: target.name, room: randomBytes(16).toString('hex'), objectId: `timer-${randomBytes(8).toString('hex')}`, startedAt: new Date().toISOString(), loadAverage: os.loadavg(), status: 'failed', steps: [], errors: [], blockedRequests: [], loadedScripts: [], videos: [] };
    results.push(trial); save();
    const participants = [];
    try {
      for (const name of ['Initiator', 'Peer']) participants.push(await openParticipant(browser, target, trial, output, name));
      const [a, b] = participants.map(participant => participant.page);
      const step = async (name, expected, action) => {
        const id = `parity-${name}-${randomBytes(8).toString('hex')}`;
        await Promise.all([a, b].map(page => page.evaluate(({ id, expected }) => window.__timerParity.arm(id, expected, 15000), { id, expected })));
        await action(id);
        await Promise.all([a, b].map(page => page.waitForFunction(id => window.__timerParity.marks[id].done, id, { timeout: 17000 })));
        const [initiator, peer] = await Promise.all([a, b].map(page => page.evaluate(id => window.__timerParity.marks[id], id)));
        const start = initiator.inputCommit?.epochMs;
        const record = { name, id, initiator, peer, status: !initiator.error && !peer.error ? 'passed' : 'failed', initiatorStateHash: hash(initiator.value?.stateJson ?? ''), peerStateHash: hash(peer.value?.stateJson ?? ''),
          metrics: start ? { firstVisibleMs: initiator.firstVisible?.epochMs - start, usableMs: initiator.usable?.epochMs - start, peerUsableMs: peer.usable?.epochMs - start } : null };
        trial.steps.push(record); save();
        console.log(JSON.stringify({ target: target.name, step: name, status: record.status, metrics: record.metrics }));
        if (record.status !== 'passed') throw new Error(`${name}: ${initiator.error ?? peer.error}`);
        return record;
      };
      const dispatch = (id, tool, params) => a.evaluate(({ id, room, tool, params }) => window.__timerParity.dispatch(id, room, tool, params), { id, room: `canvas-dev-${trial.room}`, tool, params });
      const operation = (id, operation) => a.evaluate(({ id, room, operation }) => window.__timerParity.operation(id, room, operation), { id, room: trial.room, operation });
      await step('create', { duration: 120, running: false, remaining: 120, title: 'Rebuttal' }, id => target.name === 'old'
        ? dispatch(id, 'create_component', { type: 'RetroTimerEnhanced', messageId: trial.objectId, spec: { initialMinutes: 2, initialSeconds: 0, title: 'Rebuttal', autoStart: false } })
        : operation(id, { type: 'put', object: { id: trial.objectId, kind: 'timer', title: 'Rebuttal', x: 360, y: 220, w: 280, h: 230, data: { durationMs: 120000, remainingMs: 120000, endsAt: null }, pinned: false, createdBy: 'Parity control', createdAt: Date.now(), expiresAt: null } }));
      const click = async (id, label) => {
        const shapeId = await a.evaluate(() => window.__timerParity.read().shapeId);
        const widget = a.locator(`[data-shape-id="${shapeId}"]`);
        await a.evaluate(id => document.addEventListener('pointerdown', () => window.__timerParity.commit(id), { capture: true, once: true }), id);
        await widget.getByRole('button', { name: target.name === 'old' && label !== 'Reset' ? `${label} timer` : label, exact: true }).click({ timeout: 5000 });
      };
      await step('start', { duration: 120, running: true }, id => click(id, 'Start'));
      await a.waitForTimeout(1250);
      await step('pause', { duration: 120, running: false }, id => click(id, 'Pause'));
      await step('resume', { duration: 120, running: true }, id => click(id, 'Start'));
      await step('reset', { duration: 120, running: false, remaining: 120 }, id => click(id, 'Reset'));
      const shared = await step('shared-duration', { duration: 180, running: false, remaining: 180, title: 'Shared state check' }, id => target.name === 'old'
        ? dispatch(id, 'update_component', { componentId: trial.objectId, patch: { configuredDuration: 180, timeLeft: 180, isRunning: false, title: 'Shared state check' } })
        : operation(id, { type: 'patch', id: trial.objectId, patch: { title: 'Shared state check', data: { durationMs: 180000, remainingMs: 180000, endsAt: null } } }));
      const stateHash = shared.initiatorStateHash;
      await a.waitForTimeout(3000);
      const reads = await Promise.all([a, b].map(page => page.evaluate(() => window.__timerParity.read())));
      trial.stableState = { initiator: reads[0], peer: reads[1], initiatorHash: hash(reads[0].stateJson), peerHash: hash(reads[1].stateJson) };
      const diskFile = target.name === 'old' ? resolve(root, 'docs/evidence/parity-old-bootstrap/.tldraw-local/rooms', `canvas-dev-${trial.room}`) : resolve(root, '.data/tldraw', `${trial.room}.json`);
      if (!existsSync(diskFile)) throw new Error('Expected durable room snapshot was not written.');
      const raw = readFileSync(diskFile, 'utf8'); const disk = JSON.parse(raw);
      const shape = disk.documents.map(document => document.state).find(shape => shape.id === reads[0].shapeId);
      const state = target.name === 'old' ? shape?.props.state : shape?.props.data;
      trial.disk = { file: diskFile, fileHash: hash(raw), documentClock: disk.documentClock ?? disk.clock, shape, stateHash: hash(JSON.stringify(canonical(state))) };
      writeFileSync(resolve(output, `${target.name}-disk-snapshot.json`), raw);
      const reloaded = await openParticipant(browser, target, trial, output, 'Fresh reader'); participants.push(reloaded);
      await reloaded.page.evaluate(() => window.__timerParity.arm('reload', { duration: 180, running: false, remaining: 180, title: 'Shared state check' }, 15000));
      await reloaded.page.waitForFunction(() => window.__timerParity.marks.reload.done, null, { timeout: 17000 });
      trial.reload = await reloaded.page.evaluate(() => window.__timerParity.marks.reload);
      trial.reloadStateHash = hash(trial.reload.value?.stateJson ?? '');
      trial.stateHashMatches = [trial.stableState.initiatorHash, trial.stableState.peerHash, trial.disk.stateHash, trial.reloadStateHash].every(value => value === stateHash);
      if (!trial.stateHashMatches || trial.reload.error) throw new Error('Paused state diverged between initiator, peer, disk or fresh reader.');
      for (const participant of participants) {
        try { await participant.page.screenshot({ path: resolve(output, `${target.name}-${participant.name.toLowerCase().replaceAll(' ', '-')}.png`), timeout: 30000 }); }
        catch (error) { trial.errors.push({ participant: participant.name, evidenceError: error.message }); }
      }
      trial.status = 'passed';
    } catch (error) {
      trial.error = error.message;
      for (const participant of participants) { trial.errors.push({ participant: participant.name, body: (await participant.page.locator('body').innerText().catch(() => '')).slice(0, 6000) }); await participant.page.screenshot({ path: resolve(output, `${target.name}-${participant.name}-failed.png`), timeout: 10000 }).catch(() => {}); }
    } finally {
      for (const participant of participants) trial.videos.push(await participant.close());
      trial.completedAt = new Date().toISOString(); save();
      console.log(JSON.stringify({ target: target.name, status: trial.status, error: trial.error, stateHashMatches: trial.stateHashMatches }));
    }
  }
} finally { manifest.completedAt = new Date().toISOString(); save(); await browser.close(); }

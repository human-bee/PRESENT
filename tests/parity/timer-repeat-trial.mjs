import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, openParticipant } from './timer-fixture.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const shapeHash = value => hash(JSON.stringify(canonical(value)));
export async function runTimerTrial({ browser, target, trial, output, root, save }) {
  const participants = [];
  const filename = name => resolve(output, `${target.name}-${trial.index}-${name}`);
  const capture = async (page, name) => {
    try { await page.screenshot({ path: filename(name), timeout: 30000 }); }
    catch (error) { trial.evidenceErrors ??= []; trial.evidenceErrors.push({ file: name, error: error.message }); }
  };
  const expected = { duration: 120, running: false, remaining: 120, title: 'Rebuttal' };
  try {
    for (const name of ['Initiator', 'Peer']) participants.push(await openParticipant(browser, target, trial, output, name));
    const [a, b] = participants.map(participant => participant.page);
    const setupId = `setup-${randomBytes(8).toString('hex')}`;
    await a.evaluate(id => { window.__timerParity.marks[id] = { id }; }, setupId);
    if (target.name === 'old') await a.evaluate(({ id, room, objectId }) => window.__timerParity.dispatch(id, room, 'create_component', { type: 'RetroTimerEnhanced', messageId: objectId, spec: { initialMinutes: 2, initialSeconds: 0, title: 'Rebuttal', autoStart: false } }), { id: setupId, room: `canvas-dev-${trial.room}`, objectId: trial.objectId });
    else await a.evaluate(({ id, room, objectId }) => window.__timerParity.operation(id, room, { type: 'put', object: { id: objectId, kind: 'timer', title: 'Rebuttal', x: 360, y: 220, w: 280, h: 230, data: { durationMs: 120000, remainingMs: 120000, endsAt: null }, pinned: false, createdBy: 'Parity control', createdAt: Date.now(), expiresAt: null } }), { id: setupId, room: trial.room, objectId: trial.objectId });
    await a.waitForFunction(() => !!window.__timerParity.read(), null, { timeout: 15000 });
    trial.setup = { boundary: 'Creation and old viewport resize are untimed setup; timing begins only at the actual UI control pointerdown.', creation: await a.evaluate(id => window.__timerParity.marks[id], setupId), before: await a.evaluate(() => window.__timerParity.read()) };
    if (target.name === 'old') {
      const shapeId = trial.setup.before.shapeId;
      await a.evaluate(id => { (window.__present?.tldrawEditor ?? window.__presentEditor ?? window.editor).select(id); }, shapeId);
      const bounds = await a.locator(`[data-shape-id="${shapeId}"]`).boundingBox();
      if (!bounds) throw new Error('Old timer has no resize bounds.');
      const from = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
      const to = { x: from.x, y: bounds.y + 420 };
      trial.setup.resize = { method: 'Native selection established through editor.select; real pointer drag of bottom-right resize handle, outside measurement.', from, to, requestedHeight: 420 };
      await a.mouse.move(from.x, from.y); await a.mouse.down(); await a.mouse.move(to.x, to.y, { steps: 12 }); await a.mouse.up();
      await a.waitForFunction(() => window.__timerParity.read()?.shape.props.h > 300, null, { timeout: 5000 });
    }
    await Promise.all([a, b].map(page => page.evaluate(expected => window.__timerParity.arm('setup-ready', expected, 15000), expected)));
    await Promise.all([a, b].map(page => page.waitForFunction(() => window.__timerParity.marks['setup-ready'].done, null, { timeout: 17000 })));
    trial.setup.after = await Promise.all([a, b].map(page => page.evaluate(() => window.__timerParity.marks['setup-ready'])));
    if (trial.setup.after.some(mark => mark.error)) throw new Error('Untimed setup did not show the full timer and controls in both browsers.');
    trial.setup.geometry = trial.setup.after.map(mark => ({ width: mark.value.shape.props.w, height: mark.value.shape.props.h, x: mark.value.shape.x, y: mark.value.shape.y }));
    for (const [index, page] of [a, b].entries()) await capture(page, `setup-${index ? 'peer' : 'initiator'}.png`);
    save();
    const step = async (name, running, label, remaining) => {
      const id = `parity-${name}-${randomBytes(8).toString('hex')}`;
      const expected = { duration: 120, running, ...(remaining !== undefined ? { remaining } : {}) };
      await Promise.all([a, b].map(page => page.evaluate(({ id, expected }) => window.__timerParity.arm(id, expected, 5000), { id, expected })));
      const shapeId = await a.evaluate(() => window.__timerParity.read().shapeId);
      const button = a.locator(`[data-shape-id="${shapeId}"]`).getByRole('button', { name: target.name === 'old' && label !== 'Reset' ? `${label} timer` : label, exact: true });
      await button.evaluate((element, id) => element.addEventListener('pointerdown', event => { window.__timerParity.commit(id); window.__timerParity.marks[id].pointerEventTimestamp = event.timeStamp; }, { capture: true, once: true }), id);
      await button.click({ timeout: 5000 });
      await Promise.all([a, b].map(page => page.waitForFunction(id => window.__timerParity.marks[id].done, id, { timeout: 6500 })));
      const [initiator, peer] = await Promise.all([a, b].map(page => page.evaluate(id => window.__timerParity.marks[id], id)));
      const start = initiator.inputCommit?.epochMs;
      const stateHashes = [initiator, peer].map(mark => hash(mark.value?.stateJson ?? ''));
      const record = { name, id, initiator, peer, stateHashes, status: !initiator.error && !peer.error && stateHashes[0] === stateHashes[1] && Number.isFinite(start) ? 'passed' : 'failed',
        metrics: { visibleMs: initiator.firstVisible ? initiator.firstVisible.epochMs - start : null, usableMs: initiator.usable ? initiator.usable.epochMs - start : null, peerUsableMs: peer.usable ? peer.usable.epochMs - start : null } };
      trial.steps.push(record); save();
      console.log(JSON.stringify({ target: target.name, index: trial.index, step: name, status: record.status, metrics: record.metrics }));
      if (record.status !== 'passed') throw new Error(`${name} visibility, state, or matching-peer check failed.`);
    };
    await step('start', true, 'Start');
    await a.waitForTimeout(1250);
    await step('pause', false, 'Pause');
    trial.pausedBeforeResume = await Promise.all([a, b].map(page => page.evaluate(() => window.__timerParity.read())));
    if (trial.pausedBeforeResume.some(value => value.remaining <= 0 || value.remaining >= 120)) throw new Error('Started timer did not count down before pause.');
    await step('resume', true, 'Start');
    await step('reset', false, 'Reset', 120);
    await a.waitForTimeout(3000);
    const reads = await Promise.all([a, b].map(page => page.evaluate(() => window.__timerParity.read())));
    trial.stableState = { initiator: reads[0], peer: reads[1] };
    const diskFile = target.name === 'old' ? resolve(target.storageRoot, `canvas-dev-${trial.room}`) : resolve(root, '.data/tldraw', `${trial.room}.json`);
    const raw = readFileSync(diskFile, 'utf8'); const disk = JSON.parse(raw);
    trial.disk = { file: diskFile, fileHash: hash(raw), documentClock: disk.documentClock ?? disk.clock, shape: disk.documents.map(document => document.state).find(shape => shape.id === reads[0].shapeId) };
    writeFileSync(filename('disk-snapshot.json'), raw);
    const reloaded = await openParticipant(browser, target, trial, output, 'Fresh reader'); participants.push(reloaded);
    await reloaded.page.evaluate(expected => window.__timerParity.arm('reload', expected, 15000), expected);
    await reloaded.page.waitForFunction(() => window.__timerParity.marks.reload.done, null, { timeout: 17000 });
    trial.reload = await reloaded.page.evaluate(() => window.__timerParity.marks.reload);
    trial.shapeHashes = { initiator: shapeHash(reads[0].shape), peer: shapeHash(reads[1].shape), disk: shapeHash(trial.disk.shape), freshReader: shapeHash(trial.reload.value?.shape) };
    trial.shapeHashesMatch = new Set(Object.values(trial.shapeHashes)).size === 1;
    if (!trial.shapeHashesMatch || trial.reload.error) throw new Error('Paused shape or visible state differs across initiator, peer, disk and fresh reader.');
    for (const participant of participants) await capture(participant.page, `${participant.name.toLowerCase().replaceAll(' ', '-')}.png`);
    trial.status = 'passed';
  } catch (error) {
    trial.error = error.message;
    for (const participant of participants) { trial.errors.push({ participant: participant.name, body: (await participant.page.locator('body').innerText().catch(() => '')).slice(0, 6000) }); await participant.page.screenshot({ path: filename(`${participant.name}-failed.png`), timeout: 10000 }).catch(() => {}); }
  } finally {
    for (const participant of participants) trial.videos.push(await participant.close());
    trial.completedAt = new Date().toISOString(); save();
  }
}

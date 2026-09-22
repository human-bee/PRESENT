import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

if (process.env.PRESENT_LIVE_ROOMOS !== '1') throw new Error('Explicit live RoomOS opt-in required. One synthetic voice session only.');
const output = resolve(`docs/evidence/roomos-voice-${Date.now()}`), roomId = randomBytes(16).toString('hex'); mkdirSync(output, { recursive: true });
const text = 'A truss bridge uses connected triangles to distribute loads through its structure.';
execFileSync('/usr/bin/say', ['-r', '155', '-o', `${output}/speech.aiff`, text]);
execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${output}/speech.aiff`, '-af', 'adelay=3000:all=1,apad', '-t', '45', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', `${output}/input.wav`]);
const proof = { roomId, at: new Date().toISOString(), text, synthetic: true, sessionsAllowed: 1, sessionsStarted: 0, wavSha256: createHash('sha256').update(readFileSync(`${output}/input.wav`)).digest('hex'), status: 'failed' };
const save = () => writeFileSync(`${output}/proof.json`, JSON.stringify(proof, null, 2)); save();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${output}/input.wav`, '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'] });
const contexts = []; let a, b; const deadline = setTimeout(() => void browser.close(), 80000);
try {
  for (const name of ['Synthetic listener', 'Synthetic peer']) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output, size: { width: 1440, height: 1000 } } }); contexts.push(context);
    await context.addInitScript(name => localStorage.setItem('present:name', name), name);
  }
  await contexts[0].addInitScript(() => {
    const now = () => performance.timeOrigin + performance.now(), state = { tracks: [], input: {}, transcript: [] }; window.__roomosVoice = state;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints); state.tracks.push(...stream.getTracks());
      const context = new AudioContext({ sampleRate: 48000 }); state.context = context;
      const code = `class Probe extends AudioWorkletProcessor { process(inputs) { const data = inputs[0]?.[0]; if (data) { let sum=0, first=-1, last=-1; for(let i=0;i<data.length;i++){sum+=data[i]**2;if(Math.abs(data[i])>.001){if(first<0)first=i;last=i;}} if(Math.sqrt(sum/data.length)>.001&&last>=0)this.port.postMessage({first:currentFrame+first,last:currentFrame+last,sampleRate}); }return true;} } registerProcessor('probe',Probe);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, 'probe'), silent = context.createGain(); silent.gain.value = 0;
      source.connect(node); node.connect(silent); silent.connect(context.destination);
      node.port.onmessage = ({ data }) => { const stamp = now(), current = context.currentTime; state.input.firstAudibleEpochMs ??= stamp - (current - data.first / data.sampleRate) * 1000; state.input.lastAudibleEpochMs = stamp - (current - data.last / data.sampleRate) * 1000; };
      await context.resume(); return stream;
    };
  });
  [a, b] = await Promise.all(contexts.map(c => c.newPage()));
  await Promise.all([a.goto(`/r/${roomId}`), b.goto(`/r/${roomId}`)]); await expect(a.locator('.room-status')).toHaveText('here, together'); await expect(b.locator('.room-status')).toHaveText('here, together');
  await a.getByRole('button', { name: '◈ Activities', exact: true }).click(); await a.locator('.activity-template-grid button').filter({ has: a.getByText('Debate', { exact: true }) }).click();
  await b.getByRole('button', { name: 'Open Debate', exact: true }).click();
  for (const page of [a, b]) await page.evaluate(() => {
    window.__firstActivityClaim = null;
    const watch = () => { const element = document.querySelector('.activity-focus .claim-card'), body = document.querySelector('.activity-focus .activity-body'), box = element?.getBoundingClientRect(), clip = body?.getBoundingClientRect();
      if (box && clip && box.top >= clip.top && box.bottom <= clip.bottom && box.width > 0) window.__firstActivityClaim ??= performance.timeOrigin + performance.now();
      if (!window.__firstActivityClaim) requestAnimationFrame(watch);
    }; requestAnimationFrame(watch);
  });
  proof.sessionsStarted++; save(); await a.getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect(a.getByRole('dialog').locator('.claim-card').first()).toBeVisible({ timeout: 60000 }); await expect(b.getByRole('dialog').locator('.claim-card').first()).toBeVisible({ timeout: 10000 });
  await a.getByRole('button', { name: 'Stop listening', exact: true }).click();
  proof.capture = await a.evaluate(async () => { const p = window.__roomosVoice; await p.context.close(); return { input: p.input, tracksEnded: p.tracks.every(t => t.readyState === 'ended'), firstUsefulEpochMs: window.__firstActivityClaim }; });
  proof.peerUsefulEpochMs = await b.evaluate(() => window.__firstActivityClaim);
  proof.speechEndToClaimMs = proof.capture.firstUsefulEpochMs - proof.capture.input.lastAudibleEpochMs;
  proof.speechEndToPeerClaimMs = proof.peerUsefulEpochMs - proof.capture.input.lastAudibleEpochMs;
  const read = page => page.evaluate(() => window.__presentEditor.store.allRecords().find(r => r.typeName === 'document').meta.present.roomOS);
  proof.native = await read(a); await expect.poll(() => read(b)).toEqual(proof.native);
  const activity = proof.native.activities[0];
  if (!activity.utterances.length || activity.utterances.some(u => u.source !== 'room-voice' || u.speakerId !== null) || activity.claims.some(c => c.speakerId !== null)) throw new Error('Voice provenance or unattributed claims were not preserved.');
  if (!proof.capture.tracksEnded || !proof.capture.firstUsefulEpochMs || !proof.peerUsefulEpochMs || proof.speechEndToClaimMs < 0) throw new Error('Capture shutdown or first-useful timing was incomplete.');
  await a.screenshot({ path: `${output}/listener.png` }); await b.screenshot({ path: `${output}/peer.png` });
  await a.reload(); await expect(a.locator('.room-status')).toHaveText('here, together'); await expect.poll(() => read(a)).toEqual(proof.native); proof.status = 'passed';
} catch (error) { proof.error = error instanceof Error ? error.message : String(error); if (a && !a.isClosed()) await a.screenshot({ path: `${output}/failure.png` }).catch(() => {}); }
finally { clearTimeout(deadline); await Promise.all(contexts.map(c => c.close())); await browser.close(); save(); console.log(JSON.stringify({ output, status: proof.status, error: proof.error, speechEndToClaimMs: proof.speechEndToClaimMs, speechEndToPeerClaimMs: proof.speechEndToPeerClaimMs })); if (proof.status !== 'passed') process.exitCode = 1; }

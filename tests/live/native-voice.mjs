import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputName = process.env.NATIVE_VOICE_OUTPUT ?? 'native-voice-proof';
if (!/^native-voice-[a-z0-9-]+$/.test(outputName)) throw new Error('Use a fresh native-voice-* evidence directory name.');
const output = resolve(root, 'docs/evidence', outputName), budgetPath = resolve(output, 'budget.json');
if (existsSync(budgetPath)) throw new Error('This proof already started. Preserve it and obtain authorization before choosing a fresh output directory.');
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318';
const scenarios = [
  { name: 'timer', command: 'Present, start a two-minute timer.' },
  { name: 'flow', command: 'On the canvas, create a three stage product launch flow with Research, Build, and Launch. Connect the stages in order and add a yellow note under Launch that says Measure adoption.' },
];
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, '.gitignore'), 'runtime/\n');
writeFileSync(resolve(output, 'driver.mjs'), readFileSync(fileURLToPath(import.meta.url)));
const save = (name, value) => writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
const hash = value => createHash('sha256').update(value).digest('hex');
for (const scenario of scenarios) {
  const aiff = resolve(output, `${scenario.name}-speech.aiff`), wav = resolve(output, `${scenario.name}-input.wav`);
  if (!existsSync(wav)) {
    execFileSync('/usr/bin/say', ['-r', '155', '-o', aiff, scenario.command], { timeout: 15000 });
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff,
      '-af', 'adelay=3000:all=1,apad', '-t', '85', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 15000 });
  }
  scenario.wav = wav; scenario.inputHash = hash(readFileSync(wav));
}
save('input-manifest.json', { scenarios, input: 'macOS say through ffmpeg; synthetic microphone only; 3 seconds initial silence, 85 second WAV, 48 kHz mono', hardSessionLimitMs: 75000 });
if (process.env.LIVE_VOICE !== '1' || process.env.NATIVE_VOICE_READY !== '1') {
  console.log('Prepared only. Both LIVE_VOICE=1 and NATIVE_VOICE_READY=1 are required after root readiness. No browser or provider calls.');
  process.exit(0);
}
const budget = { allowed: 2, started: 0, startedAt: new Date().toISOString() }; save('budget.json', budget);
const require = createRequire(import.meta.url);
const metadata = JSON.parse(readFileSync(resolve(dirname(require.resolve('playwright-core')), 'browsers.json'), 'utf8'));
const encoderDirectory = resolve(output, 'runtime', `ffmpeg-${metadata.browsers.find(item => item.name === 'ffmpeg').revision}`);
mkdirSync(encoderDirectory, { recursive: true });
if (!existsSync(resolve(encoderDirectory, 'ffmpeg-mac'))) symlinkSync('/opt/homebrew/bin/ffmpeg', resolve(encoderDirectory, 'ffmpeg-mac'));
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(output, 'runtime');
const { chromium, expect } = await import('@playwright/test');

function installCaptureProbe() {
  const stamp = () => performance.timeOrigin + performance.now();
  const proof = { tracks: [], peers: [], events: [], transcripts: [], input: { rmsThreshold: .001, amplitudeThreshold: .001 }, startEpochMs: null };
  window.__nativeVoice = proof;
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await capture(constraints); proof.tracks.push(...stream.getTracks()); proof.input.captureStartedEpochMs = stamp();
    const context = new AudioContext({ sampleRate: 48000 }); proof.audioContext = context;
    const source = context.createMediaStreamSource(stream);
    const code = `class CaptureProbe extends AudioWorkletProcessor { process(inputs) { const data = inputs[0]?.[0]; if (data) { let sum = 0, last = -1, first = -1; for (let i = 0; i < data.length; i++) { sum += data[i] ** 2; if (Math.abs(data[i]) > .001) { last = i; if (first < 0) first = i; } } const rms = Math.sqrt(sum / data.length); if (rms > .001 && last >= 0) this.port.postMessage({ firstFrame: currentFrame + first, lastFrame: currentFrame + last, sampleRate, rms }); } return true; } } registerProcessor('capture-probe', CaptureProbe);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(context, 'capture-probe'), silent = context.createGain(); silent.gain.value = 0;
    source.connect(node); node.connect(silent); silent.connect(context.destination);
    node.port.onmessage = ({ data }) => {
      // Map observed capture-graph samples to the browser clock; never use provider VAD as input timing.
      const observedEpochMs = stamp(), currentContextTime = context.currentTime;
      const sampleEpochMs = frame => observedEpochMs - (currentContextTime - frame / data.sampleRate) * 1000;
      proof.input.firstAudibleEpochMs ??= sampleEpochMs(data.firstFrame);
      proof.input.lastAudibleEpochMs = sampleEpochMs(data.lastFrame);
      proof.input.lastAudibleFrame = data.lastFrame; proof.input.sampleRate = data.sampleRate;
      proof.input.lastRms = data.rms; proof.input.lastBlockObservedEpochMs = observedEpochMs;
    };
    await context.resume(); proof.input.probeReadyEpochMs = stamp(); return stream;
  };
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(Original, { construct(target, args) {
    const peer = new target(...args); proof.peers.push(peer);
    const addTrack = peer.addTrack.bind(peer); peer.addTrack = (track, ...streams) => { proof.tracks.push(track); return addTrack(track, ...streams); };
    const create = peer.createDataChannel.bind(peer); peer.createDataChannel = (label, options) => {
      const channel = create(label, options);
      channel.addEventListener('message', message => {
        try { const event = JSON.parse(String(message.data)); if (typeof event.type !== 'string') return;
          proof.events.push({ type: event.type, epochMs: stamp(), status: event.response?.status, name: event.name, callId: event.call_id, providerAudioEndMs: event.audio_end_ms, errorCode: event.error?.code, errorMessage: event.error?.message });
          if (event.type === 'conversation.item.input_audio_transcription.completed') proof.transcripts.push({ role: 'user', text: event.transcript, epochMs: stamp() });
          if (event.type === 'session.created') proof.providerModel = event.session?.model;
        } catch { /* Non-JSON packets are irrelevant. Do not save SDP or credentials. */ }
      }); return channel;
    }; return peer;
  } });
}

function installNativeProbe(scenario) {
  const editor = window.__presentEditor;
  const stamp = () => performance.timeOrigin + performance.now();
  const richText = value => !value || typeof value !== 'object' ? '' : typeof value.text === 'string' ? value.text : (value.content ?? []).map(richText).join(' ');
  const visibleElement = (element, fully = false) => { const bounds = element?.getBoundingClientRect();
    return !!bounds && bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight && getComputedStyle(element).visibility !== 'hidden'
      && (!fully || (bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight)); };
  const visible = (shape, fully = false) => visibleElement(document.querySelector(`[data-shape-id="${shape.id}"]`), fully);
  const read = () => {
    const shapes = editor.getCurrentPageShapes(), bindings = editor.store.allRecords().filter(record => record.typeName === 'binding');
    const timer = shapes.find(shape => shape.type === 'present-widget' && shape.props.kind === 'timer');
    const stages = ['Research', 'Build', 'Launch'].map(label => shapes.find(shape => shape.type === 'geo' && richText(shape.props.richText).trim().toLowerCase() === label.toLowerCase()));
    const note = shapes.find(shape => shape.type === 'note' && /measure adoption/i.test(richText(shape.props.richText)));
    const arrows = shapes.filter(shape => shape.type === 'arrow');
    const orderedBindings = stages.every(Boolean) && [[0, 1], [1, 2]].every(([from, to]) => arrows.some(arrow => bindings.some(binding => binding.fromId === arrow.id && binding.toId === stages[from].id && binding.props.terminal === 'start') && bindings.some(binding => binding.fromId === arrow.id && binding.toId === stages[to].id && binding.props.terminal === 'end')));
    const element = timer && document.querySelector(`[data-shape-id="${timer.id}"]`);
    const controls = element ? [...element.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), disabled: button.disabled, visible: visibleElement(button, true) })) : [];
    const timeVisible = !!element && [...element.querySelectorAll('*')].some(node => !node.children.length && /^\d{1,2}:\d{2}$/.test(node.textContent.trim()) && visibleElement(node, true));
    const noteBelowLaunch = !!note && !!stages[2] && note.y >= stages[2].y + stages[2].props.h;
    const nativeCorrect = scenario === 'timer' ? !!timer && timer.props.data.durationMs === 120000 && typeof timer.props.data.endsAt === 'number'
      : stages.every(Boolean) && arrows.length === 2 && !!note && note.props.color === 'yellow' && noteBelowLaunch && orderedBindings;
    const correct = nativeCorrect && (scenario !== 'timer' || (timeVisible && controls.some(button => button.text === 'Pause' && !button.disabled && button.visible)));
    const targets = scenario === 'timer' ? [timer].filter(Boolean) : [...stages.filter(Boolean), ...arrows, ...(note ? [note] : [])];
    return { shapes, bindings, nativeCorrect, correct, visibleIds: targets.filter(shape => visible(shape)).map(shape => shape.id), fullyVisibleIds: targets.filter(shape => visible(shape, true)).map(shape => shape.id), offscreenIds: targets.filter(shape => !visible(shape)).map(shape => shape.id), notFullyVisibleIds: targets.filter(shape => !visible(shape, true)).map(shape => shape.id), targetIds: targets.map(shape => shape.id), orderedBindings, noteBelowLaunch, timeVisible, controls };
  };
  const result = { armedEpochMs: stamp(), scenario, frameCount: 0 };
  window.__nativeResult = { result, read };
  const observe = () => { result.frameCount++; const value = read();
    if (!result.firstVisibleEpochMs && value.visibleIds.length) result.firstVisibleEpochMs = stamp();
    if (!result.nativeCompleteEpochMs && value.nativeCorrect) { result.nativeCompleteEpochMs = stamp(); result.nativeCompleteValue = value; }
    if (!result.usableEpochMs && value.correct && value.targetIds.length === value.fullyVisibleIds.length) { result.usableEpochMs = stamp(); result.usableValue = value; }
    if (!result.stopped) requestAnimationFrame(observe);
  }; requestAnimationFrame(observe);
}

const sourceFiles = ['src/app.tsx', 'src/canvas.tsx', 'src/voice-control.tsx', 'src/voice/use-voice.ts', 'src/voice/realtime-events.ts', 'src/tldraw/focus.ts', 'server/agents/voice-session.ts', 'server/agents/voice-tools.ts', 'server/agents/canvas-tools.ts', 'shared/canvas-commands.ts', 'tests/live/native-voice.mjs'];
const source = () => Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(resolve(root, path)))]));
const results = [];
for (const scenario of scenarios) {
  const roomId = randomBytes(16).toString('hex'), report = { scenario: scenario.name, command: scenario.command, roomId, at: new Date().toISOString(), status: 'failed', provider: 'OpenAI Realtime', mockedModelOutputs: false, sourceBefore: source(), requests: [], errors: [], inputHash: scenario.inputHash };
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${scenario.wav}`, '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.browser = browser.version(); const contexts = [], pages = []; let safetyTimer;
  try {
    for (const participant of ['Initiator', 'Peer']) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: resolve(output, 'videos'), size: { width: 1440, height: 900 } } }); contexts.push(context);
      await context.addInitScript(name => localStorage.setItem('present:name', `Synthetic voice ${name}`), participant);
      if (participant === 'Initiator') await context.addInitScript(installCaptureProbe);
      const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(5000);
      page.on('pageerror', error => report.errors.push({ participant, message: error.message }));
      page.on('request', request => { const route = new URL(request.url()).pathname; if (!route.startsWith('/api/voice/')) return;
        let name; if (route === '/api/voice/tool') { try { name = request.postDataJSON()?.name; } catch {} }
        report.requests.push({ route, name, requestEpochMs: Date.now(), request });
      });
      page.on('response', response => { const entry = report.requests.find(item => item.request === response.request()); if (entry) { entry.status = response.status(); entry.responseEpochMs = Date.now(); } });
    }
    const [initiator, peer] = pages;
    await Promise.all(pages.map(async page => { await page.goto(`/r/${roomId}`); await expect(page.locator('.room-status')).toHaveText('here, together'); await page.waitForFunction(() => !!window.__presentEditor); await page.evaluate(installNativeProbe, scenario.name); }));
    report.startEpochMs = await initiator.evaluate(() => { window.__nativeVoice.startEpochMs = performance.timeOrigin + performance.now(); return window.__nativeVoice.startEpochMs; });
    budget.started++; save('budget.json', budget);
    safetyTimer = setTimeout(() => { report.safetyClosed = true; void browser.close(); }, 75000);
    await initiator.getByRole('button', { name: 'Start listening', exact: true }).click();
    await initiator.waitForFunction(() => !!window.__nativeResult.result.usableEpochMs || !!document.querySelector('.voice-error'), null, { timeout: 60000 });
    if (await initiator.locator('.voice-error').isVisible()) throw new Error(await initiator.locator('.voice-error').innerText());
    await peer.waitForFunction(() => !!window.__nativeResult.result.nativeCompleteEpochMs, null, { timeout: 5000 });
    await initiator.waitForFunction(() => window.__nativeVoice.events.some(event => event.type === 'response.done' && event.status === 'completed'), null, { timeout: 5000 });
    const values = await Promise.all(pages.map(page => page.evaluate(() => window.__nativeResult.read())));
    const sortKeys = value => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value;
    const canonical = records => JSON.stringify(records.map(record => JSON.stringify(sortKeys(record))).sort());
    if (canonical(values[0].shapes) !== canonical(values[1].shapes) || canonical(values[0].bindings) !== canonical(values[1].bindings)) throw new Error('Native peers did not converge to identical shape and binding records.');
    const firstComplete = await Promise.all(pages.map(page => page.evaluate(() => window.__nativeResult.result.nativeCompleteValue)));
    report.firstNativeCompleteStatesConverged = canonical(firstComplete[0].shapes) === canonical(firstComplete[1].shapes) && canonical(firstComplete[0].bindings) === canonical(firstComplete[1].bindings);
    report.peerConverged = true; report.peerConvergedReadbackEpochMs = Date.now();
    const snapshot = await peer.evaluate(async id => { const response = await fetch(`/api/room/${id}/document`); if (!response.ok) throw new Error('Native document readback failed'); return response.json(); }, roomId);
    const records = snapshot.snapshot.documents.map(entry => entry.state), durableShapes = records.filter(record => record.typeName === 'shape'), durableBindings = records.filter(record => record.typeName === 'binding');
    save(`${scenario.name}-document.json`, snapshot);
    report.durable = { shapeCount: durableShapes.length, bindingCount: durableBindings.length, shapes: durableShapes, bindings: durableBindings, verifiedEpochMs: Date.now() };
    if (canonical(durableShapes) !== canonical(values[0].shapes) || canonical(durableBindings) !== canonical(values[0].bindings)) throw new Error('Durable native records differ from browser peers.');
    const diskPath = resolve(root, '.data/tldraw', `${roomId}.json`);
    await expect.poll(() => { if (!existsSync(diskPath)) return false; const saved = JSON.parse(readFileSync(diskPath, 'utf8')).documents.map(entry => entry.state);
      return canonical(saved.filter(record => record.typeName === 'shape')) === canonical(durableShapes) && canonical(saved.filter(record => record.typeName === 'binding')) === canonical(durableBindings);
    }, { timeout: 5000 }).toBe(true);
    const diskBytes = readFileSync(diskPath); report.durable.disk = { path: diskPath, verifiedEpochMs: Date.now(), sha256: hash(diskBytes) }; writeFileSync(resolve(output, `${scenario.name}-disk.json`), diskBytes);
    report.status = 'passed';
  } catch (error) { report.error = error.message; }
  finally {
    for (const [index, page] of pages.entries()) if (!page.isClosed()) {
      try { await page.screenshot({ path: resolve(output, `${scenario.name}-${index ? 'peer' : 'initiator'}.png`), timeout: 5000 });
        report[index ? 'peer' : 'initiator'] = await page.evaluate(() => ({ ...window.__nativeResult?.result, finalValue: window.__nativeResult?.read() }));
        if (!index) {
          const stop = page.getByRole('button', { name: 'Stop listening', exact: true }); if (await stop.isVisible()) await stop.click({ timeout: 3000 });
          await expect.poll(() => page.evaluate(() => window.__nativeVoice.tracks.every(track => track.readyState === 'ended')), { timeout: 3000 }).toBe(true);
          report.realtime = await page.evaluate(async () => { const proof = window.__nativeVoice; await proof.audioContext?.close(); return { events: proof.events, transcripts: proof.transcripts, providerModel: proof.providerModel, input: proof.input, tracks: proof.tracks.map(track => ({ kind: track.kind, readyState: track.readyState })), peers: proof.peers.map(peer => ({ connectionState: peer.connectionState, signalingState: peer.signalingState, receivers: peer.getReceivers().map(receiver => ({ kind: receiver.track.kind, readyState: receiver.track.readyState })) })) }; });
          report.capturedTracksEnded = report.realtime.tracks.every(track => track.readyState === 'ended'); report.stoppedEpochMs = Date.now();
        }
      } catch (error) { report.cleanupError = error.message; report.status = 'failed'; }
    }
    clearTimeout(safetyTimer);
    await Promise.all(contexts.map(context => context.close().catch(error => { report.errors.push({ message: error.message }); })));
    report.videos = await Promise.all(pages.map(page => page.video()?.path()));
    report.pagesClosed = pages.every(page => page.isClosed()); await browser.close(); report.ownBrowserClosed = !browser.isConnected();
    report.sourceAfter = source(); report.sourceChangedDuringRun = JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
    report.requests = report.requests.map(({ request, ...entry }) => entry);
    const audibleEnd = report.realtime?.input.lastAudibleEpochMs, providerStops = report.realtime?.events.filter(event => event.type === 'input_audio_buffer.speech_stopped') ?? [], providerEnd = providerStops.at(-1)?.epochMs;
    report.providerBoundary = { type: 'last observed input_audio_buffer.speech_stopped before listener stop', count: providerStops.length, epochMs: providerEnd };
    if (!audibleEnd || !providerEnd) { report.status = 'failed'; report.timingError = 'Missing observed input speech or provider speech-stopped boundary.'; }
    const delta = (end, start) => typeof end === 'number' && typeof start === 'number' ? Math.round((end - start) * 10) / 10 : null;
    report.metrics = { capturedAudibleEndToFirstVisibleMs: delta(report.initiator?.firstVisibleEpochMs, audibleEnd), capturedAudibleEndToUsableMs: delta(report.initiator?.usableEpochMs, audibleEnd), capturedAudibleEndToPeerNativeCompleteMs: delta(report.peer?.nativeCompleteEpochMs, audibleEnd), capturedAudibleEndToPeerFirstVisibleMs: delta(report.peer?.firstVisibleEpochMs, audibleEnd), capturedAudibleEndToPeerUsableMs: delta(report.peer?.usableEpochMs, audibleEnd), capturedAudibleEndToPeerConvergedReadbackMs: delta(report.peerConvergedReadbackEpochMs, audibleEnd), capturedAudibleEndToDiskReadbackMs: delta(report.durable?.disk?.verifiedEpochMs, audibleEnd), providerSpeechStoppedToFirstVisibleMs: delta(report.initiator?.firstVisibleEpochMs, providerEnd), capturedAudibleEndToProviderSpeechStoppedMs: delta(providerEnd, audibleEnd) };
    report.timingMethod = 'AudioWorklet RMS > 0.001 and last sample amplitude > 0.001 on actual captured synthetic microphone; audio-context sample clock mapped at callback to performance clock. This is an observed input boundary, with render-quantum/callback timing uncertainty. Provider speech_stopped is recorded separately. Native visibility and usable state are observed on requestAnimationFrame.';
    results.push(report); save(`${scenario.name}.json`, report); save('results.json', { sessionBudget: budget, results });
    console.log(JSON.stringify({ scenario: report.scenario, status: report.status, metrics: report.metrics, durable: report.durable && { shapes: report.durable.shapeCount, bindings: report.durable.bindingCount }, error: report.error, cleanupError: report.cleanupError, closed: report.ownBrowserClosed }));
  }
}
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;

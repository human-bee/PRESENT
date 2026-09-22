import { readFileSync, writeFileSync, linkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { hash } from './timer-fixture.mjs';

const directory = resolve(process.argv[2] ?? 'docs/evidence/parity-timer-control');
const run = JSON.parse(readFileSync(resolve(directory, 'results.json'), 'utf8'));
if (!run.manifest.completedAt) throw new Error('Wait for the complete run.');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const shapeHash = shape => hash(JSON.stringify(canonical(shape)));
const summary = {
  classification: run.manifest.classification,
  timingBoundary: 'One sequential old/new pair. Raw metric field usableMs means DOM time/control presence plus expected native state; the original probe did not check clipped descendants. Old timings do not establish complete visual usability. No percentiles or superiority claim.',
  visualQA: {
    old: { status: 'failed', finding: 'Default 300x160 shape clips content: peer/fresh reader shows title/time but no controls; initiator after real control clicks shows controls with title/time scrolled out. The full widget is not visible at once.', evidence: ['old-initiator.png', 'old-peer.png', 'old-fresh-reader.png'] },
    new: { status: 'passed', finding: 'Fresh reader shows the title, 3:00 time, Start/Reset controls, and 3 min duration together.', evidence: ['new-fresh-reader.png'] },
  },
  probeCorrection: 'The browser probe now checks descendant visibility with bounding boxes and elementFromPoint. It has not been rerun; original raw results and their driver hashes remain unchanged.',
  results: run.results.map(trial => {
    const shapes = { initiator: trial.stableState?.initiator.shape, peer: trial.stableState?.peer.shape, disk: trial.disk?.shape, freshReader: trial.reload?.value.shape };
    const hashes = Object.fromEntries(Object.entries(shapes).map(([name, shape]) => [name, shapeHash(shape)]));
    const scripts = new Map();
    for (const script of trial.loadedScripts) { const values = scripts.get(script.url) ?? new Set(); values.add(script.hash ?? script.error); scripts.set(script.url, values); }
    return { target: trial.target, room: trial.room, nativeStateAndControls: trial.status, completeVisualUsability: trial.target === 'old' ? 'failed' : 'passed',
      oneMinuteLoad: trial.loadAverage[0], errors: trial.errors.length, blockedRequests: trial.blockedRequests.length,
      pausedStateHashMatches: trial.stateHashMatches, fullNativeShapeHashes: hashes, fullNativeShapeHashesMatch: new Set(Object.values(hashes)).size === 1,
      diskDocumentClock: trial.disk?.documentClock,
      durabilityBoundary: 'Actual saved JSON and fresh-browser readback match. Servers were not restarted, so process-loss recovery is unmeasured.',
      steps: trial.steps.map(step => ({ name: step.name, stateStatus: step.status, initiatorDomStateReadyMs: step.metrics?.usableMs, peerDomStateReadyMs: step.metrics?.peerUsableMs, stateHashesMatch: step.initiatorStateHash === step.peerStateHash })),
      loadedScriptResponses: trial.loadedScripts.length, scriptReadFailures: trial.loadedScripts.filter(script => script.error).length,
      changedLoadedScriptURLs: [...scripts].filter(([, hashes]) => hashes.size > 1).map(([url, hashes]) => ({ url, hashes: [...hashes] })),
      videos: trial.videos.map(video => {
        const probe = JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration,size', '-of', 'json', video.file], { encoding: 'utf8' }));
        if (video.participant === 'Initiator') {
          const alias = resolve(directory, `${trial.target}-timer-example.webm`);
          if (!existsSync(alias)) linkSync(video.file, alias);
        }
        return { ...video, probe };
      }),
    };
  }),
};
writeFileSync(resolve(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

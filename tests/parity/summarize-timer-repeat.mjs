import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const directories = (process.argv.length > 2 ? process.argv.slice(2) : ['docs/evidence/parity-timer-repeat']).map(path => resolve(path));
const segments = directories.map(path => ({ path, ...JSON.parse(readFileSync(resolve(path, 'results.json'), 'utf8')) }));
if (segments.some(segment => !segment.manifest.completedAt)) throw new Error('Wait for complete segments.');
if (new Set(segments.map(segment => segment.manifest.driverHashes['browser-timer.mjs'])).size !== 1) throw new Error('Do not combine runs with different timing probes.');
const trials = segments.flatMap(segment => segment.results.map(trial => ({ ...trial, segment: segment.path })));
if (new Set(trials.map(trial => `${trial.target}:${trial.index}`)).size !== trials.length) throw new Error('A target/index was repeated; keep those attempts separate.');
const round = value => Math.round(value * 10) / 10;
const describe = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return { samples: sorted.length, min: round(sorted[0]), median: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2), max: round(sorted.at(-1)) };
};
const summary = {
  classification: 'Interleaved browser timer controls after untimed usable setup. No creation, voice/model, or process-loss recovery comparison.',
  timing: segments[0].manifest.timing,
  statisticalBoundary: 'Median and observed range only. Latencies below are conditional on successful visible-state checks; every failed/setup-incomplete trial remains counted separately. Five pairs cannot establish dependable p95 or broad superiority.',
  sources: segments.flatMap(segment => segment.manifest.targets.map(target => ({ segment: segment.path, ...target }))),
  targets: ['old', 'new'].map(name => {
    const selected = trials.filter(trial => trial.target === name);
    const scriptHashes = new Map();
    for (const trial of selected) for (const script of trial.loadedScripts) {
      const set = scriptHashes.get(script.url) ?? new Set(); set.add(script.hash ?? `error:${script.error}`); scriptHashes.set(script.url, set);
    }
    return { name, requestedPairs: 5, attempted: selected.length, completed: selected.filter(trial => trial.status === 'passed').length,
      failures: selected.filter(trial => trial.status !== 'passed').map(trial => ({ index: trial.index, error: trial.error, completedSteps: trial.steps.map(step => step.name) })),
      screenshotFailures: selected.flatMap(trial => (trial.evidenceErrors ?? []).map(error => ({ index: trial.index, ...error }))),
      stateMismatchTrials: selected.filter(trial => trial.shapeHashesMatch === false).map(trial => trial.index),
      pausedShapeReadbackPasses: selected.filter(trial => trial.shapeHashesMatch === true).length,
      oldResizeBoundary: name === 'old' ? 'Default size was clipped in the earlier run. Each old fixture was explicitly resized by a real pointer drag before control measurement.' : null,
      geometry: selected.map(trial => ({ index: trial.index, original: trial.setup?.before ? { width: trial.setup.before.shape.props.w, height: trial.setup.before.shape.props.h } : null, after: trial.setup?.geometry ?? null, resize: trial.setup?.resize ?? null })),
      oneMinuteLoad: describe(selected.map(trial => trial.loadAverage[0])),
      errors: selected.reduce((sum, trial) => sum + trial.errors.length, 0), blockedRequests: selected.reduce((sum, trial) => sum + trial.blockedRequests.length, 0),
      loadedScriptResponses: selected.reduce((sum, trial) => sum + trial.loadedScripts.length, 0),
      changedLoadedScriptURLs: [...scriptHashes].filter(([, hashes]) => hashes.size > 1).map(([url, hashes]) => ({ url, hashes: [...hashes] })),
      steps: ['start', 'pause', 'resume', 'reset'].map(stepName => {
        const steps = selected.flatMap(trial => trial.steps.filter(step => step.name === stepName));
        const successful = steps.filter(step => step.status === 'passed');
        return { name: stepName, attempted: steps.length, passed: successful.length, failed: steps.length - successful.length,
          visibleMs: describe(successful.map(step => step.metrics.visibleMs)), usableMs: describe(successful.map(step => step.metrics.usableMs)), peerUsableMs: describe(successful.map(step => step.metrics.peerUsableMs)) };
      }),
    };
  }),
  videos: trials.flatMap(trial => trial.videos.map(video => {
    try { return { target: trial.target, index: trial.index, ...video, probe: JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration,size', '-of', 'json', video.file], { encoding: 'utf8' })) }; }
    catch (error) { return { target: trial.target, index: trial.index, ...video, error: error.message }; }
  })),
};
writeFileSync(resolve(directories[0], 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ targets: summary.targets, videos: summary.videos.length, videoErrors: summary.videos.filter(video => video.error).length }, null, 2));

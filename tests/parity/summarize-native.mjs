import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directories = (process.argv.length > 2 ? process.argv.slice(2) : ['docs/evidence/parity-matched-native']).map(path => resolve(path));
const directory = directories[0];
const segments = directories.map(path => ({ path, ...JSON.parse(readFileSync(resolve(path, 'results.json'), 'utf8')) }));
if (segments.some(segment => !segment.manifest.completedAt)) throw new Error('Wait for all segments to finish.');
if (new Set(segments.map(segment => segment.manifest.driverHashes['browser-probe.mjs'])).size !== 1) throw new Error('The timing probe changed between segments.');
const corrections = [];
const run = {
  manifest: segments[0].manifest,
  results: segments.flatMap(segment => segment.results.map(trial => {
    if (trial.error?.startsWith('page.screenshot:') && trial.initiator?.usable && trial.peer?.usable && trial.initiatorHash === trial.peerHash) {
      const start = trial.initiator.inputCommit.epochMs;
      const metrics = { firstVisibleMs: trial.initiator.firstVisible.epochMs - start, usableMs: trial.initiator.usable.epochMs - start, peerConvergedMs: trial.peer.usable.epochMs - start, browserAppliedMs: trial.initiator.browserApplied.epochMs - start };
      corrections.push({ segment: segment.path, target: trial.target, index: trial.index, originalMetrics: trial.metrics, metrics, reason: 'The first driver incorrectly replaced completed action metrics with timeout sentinels after a later screenshot timeout. Recomputed solely from preserved raw browser marks; original result file is unchanged.' });
      return { ...trial, metrics, evidenceStatus: 'failed', evidenceError: trial.error };
    }
    return trial;
  })),
};
const round = value => Math.round(value * 10) / 10;
const describe = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { min: round(sorted[0]), median: round(median), max: round(sorted.at(-1)) };
};
const summary = {
  classification: run.manifest.classification,
  percentileBoundary: 'Five-trial warm control smoke. Median and observed range only; no dependable p95, voice latency, or broad superiority conclusion.',
  browser: run.manifest.browser, encoder: run.manifest.encoder,
  corrections,
  sources: segments.flatMap(segment => segment.manifest.targets.map(({ name, commit, sourceHash, endingSourceHash, sourceChangedDuringRun, trackedDiffHash }) => ({ segment: segment.path, name, commit, sourceHash, endingSourceHash, sourceChangedDuringRun, trackedDiffHash }))),
  targets: run.manifest.targets.map(target => {
    const trials = run.results.filter(trial => trial.target === target.name);
    return {
      name: target.name, requestedTrials: run.manifest.trialCountPerTarget,
      completedTrials: trials.length, passed: trials.filter(trial => trial.status === 'passed').length,
      failed: trials.filter(trial => trial.status !== 'passed').length,
      bootstrapFailures: trials.filter(trial => trial.phase === 'bootstrap').length,
      stateHashMismatches: trials.filter(trial => trial.initiatorHash && trial.initiatorHash !== trial.peerHash).length,
      screenshotFailures: trials.filter(trial => trial.evidenceStatus === 'failed').length,
      latencyMs: Object.fromEntries(['firstVisibleMs', 'usableMs', 'peerConvergedMs'].map(metric => [metric, describe(trials.flatMap(trial => trial.metrics ? [trial.metrics[metric]] : []))])),
      oneMinuteLoad: describe(trials.map(trial => trial.loadAverage[0])),
      browserErrorCount: trials.reduce((sum, trial) => sum + trial.errors.length, 0),
      blockedRequestCount: trials.reduce((sum, trial) => sum + trial.blockedRequests.length, 0),
    };
  }),
};
const videos = segments.flatMap(segment => {
  const windows = segment.results.map((trial, index) => ({ target: trial.target, index: trial.index, requestId: trial.requestId, start: Date.parse(trial.startedAt), end: Date.parse(segment.results[index + 1]?.startedAt ?? segment.manifest.completedAt) }));
  return readdirSync(resolve(segment.path, 'videos')).filter(file => file.endsWith('.webm')).map(file => {
  const stat = statSync(resolve(segment.path, 'videos', file));
  const window = windows.find(trial => stat.birthtimeMs >= trial.start && stat.birthtimeMs < trial.end);
  return { file: resolve(segment.path, 'videos', file), bytes: stat.size, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString(), trialByFileCreationTime: window ?? null };
  });
});
summary.videoMappingBoundary = 'Video/trial associations use filesystem creation times inside nonoverlapping trial start/end windows; no request ID is embedded in the video.';
summary.videos = videos;
writeFileSync(resolve(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

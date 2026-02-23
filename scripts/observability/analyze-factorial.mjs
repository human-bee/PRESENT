#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const inputPath =
  process.env.FACTORIAL_RESULTS_PATH ||
  process.env.FACTORIAL_METRICS_PATH ||
  'artifacts/latency/factorial-runs.json';
const summaryPath =
  process.env.FACTORIAL_SUMMARY_PATH ||
  'artifacts/latency/factorial-summary.json';
const controlVariantId = process.env.FACTORIAL_CONTROL_VARIANT_ID || 'v00';
const reliabilityMarginPct = Number.parseFloat(
  process.env.FACTORIAL_RELIABILITY_MARGIN_PCT || '0.5',
);

const percentile = (values, p) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[rank];
};

const toRun = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const variantId =
    (typeof entry.variant_id === 'string' && entry.variant_id.trim()) ||
    (typeof entry.variantId === 'string' && entry.variantId.trim()) ||
    'unknown';
  const experimentId =
    (typeof entry.experiment_id === 'string' && entry.experiment_id.trim()) ||
    (typeof entry.experimentId === 'string' && entry.experimentId.trim()) ||
    null;
  const latencyMs =
    typeof entry.latencyMs === 'number' && Number.isFinite(entry.latencyMs)
      ? entry.latencyMs
      : typeof entry.dtPaintMs === 'number' && Number.isFinite(entry.dtPaintMs)
        ? entry.dtPaintMs
        : null;
  const statusRaw =
    (typeof entry.status === 'string' && entry.status.trim().toLowerCase()) ||
    (typeof entry.resultStatus === 'string' && entry.resultStatus.trim().toLowerCase()) ||
    (typeof entry.lifecycleStatus === 'string' && entry.lifecycleStatus.trim().toLowerCase()) ||
    'unknown';
  const reliable = statusRaw === 'queued+applied' || statusRaw === 'applied' || statusRaw === 'succeeded';
  const failed = statusRaw === 'failed' || statusRaw === 'error' || statusRaw === 'timeout';

  return {
    variantId,
    experimentId,
    latencyMs,
    status: statusRaw,
    reliable,
    failed,
  };
};

const summarize = (runs) => {
  const byVariant = new Map();
  for (const run of runs) {
    const key = run.variantId;
    if (!byVariant.has(key)) {
      byVariant.set(key, {
        variantId: key,
        experimentId: run.experimentId,
        sampleCount: 0,
        reliableCount: 0,
        failedCount: 0,
        latencies: [],
      });
    }
    const bucket = byVariant.get(key);
    bucket.sampleCount += 1;
    if (run.reliable) bucket.reliableCount += 1;
    if (run.failed) bucket.failedCount += 1;
    if (typeof run.latencyMs === 'number') bucket.latencies.push(run.latencyMs);
  }

  const variantRows = Array.from(byVariant.values()).map((bucket) => {
    const reliabilityRate = bucket.sampleCount > 0 ? bucket.reliableCount / bucket.sampleCount : 0;
    const failureRate = bucket.sampleCount > 0 ? bucket.failedCount / bucket.sampleCount : 0;
    const p50Ms = percentile(bucket.latencies, 0.5);
    const p95Ms = percentile(bucket.latencies, 0.95);
    return {
      variantId: bucket.variantId,
      experimentId: bucket.experimentId,
      sampleCount: bucket.sampleCount,
      reliableCount: bucket.reliableCount,
      failedCount: bucket.failedCount,
      reliabilityRate,
      failureRate,
      p50Ms,
      p95Ms,
    };
  });

  const control = variantRows.find((row) => row.variantId === controlVariantId) || null;
  const reliabilityFloor =
    control && Number.isFinite(control.reliabilityRate)
      ? control.reliabilityRate - reliabilityMarginPct / 100
      : null;

  const regressions = variantRows
    .filter((row) => {
      if (row.variantId === controlVariantId) return false;
      if (reliabilityFloor === null) return false;
      return row.reliabilityRate < reliabilityFloor;
    })
    .map((row) => ({
      variantId: row.variantId,
      reliabilityRate: row.reliabilityRate,
      requiredMin: reliabilityFloor,
    }));

  const latencyRows = variantRows.filter((row) => typeof row.p95Ms === 'number');
  const globalP95 =
    latencyRows.length > 0
      ? latencyRows.reduce((max, row) => Math.max(max, Number(row.p95Ms || 0)), 0)
      : null;

  return {
    checkedAt: new Date().toISOString(),
    inputPath,
    controlVariantId,
    reliabilityMarginPct,
    reliabilityFloor,
    variants: variantRows,
    regressions,
    globalP95,
    status: regressions.length === 0 ? 'passed' : 'failed',
  };
};

const run = async () => {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch {
    const summary = {
      checkedAt: new Date().toISOString(),
      inputPath,
      status: 'skipped',
      reason: 'input_not_found',
    };
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`[factorial] skipped: no input file at ${inputPath}`);
    return;
  }

  const sourceRuns = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.runs)
      ? parsed.runs
      : [];
  const runs = sourceRuns.map(toRun).filter(Boolean);

  if (runs.length === 0) {
    const summary = {
      checkedAt: new Date().toISOString(),
      inputPath,
      status: 'skipped',
      reason: 'no_runs',
    };
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log('[factorial] skipped: no parseable run rows');
    return;
  }

  const summary = summarize(runs);
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(
    `[factorial] variants=${summary.variants.length} regressions=${summary.regressions.length} control=${controlVariantId}`,
  );

  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
};

await run();

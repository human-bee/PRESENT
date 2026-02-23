#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const metricsPath =
  process.env.LATENCY_METRICS_PATH || process.env.PLAYWRIGHT_LATENCY_METRICS_FILE || 'artifacts/latency/deterministic-lane.json';
const summaryPath = process.env.LATENCY_SOFT_GATE_SUMMARY_PATH || 'artifacts/latency/soft-gate-summary.json';
const thresholdMs = Number.parseInt(process.env.DETERMINISTIC_LANE_P95_THRESHOLD_MS ?? '800', 10) || 800;

const percentile = (sortedValues, p) => {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * p) - 1),
  );
  return sortedValues[rank];
};

const parseSamples = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  const direct = Array.isArray(payload.samples) ? payload.samples : [];
  const numericDirect = direct
    .map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
    .filter((entry) => Number.isFinite(entry));
  if (numericDirect.length > 0) {
    return numericDirect.sort((a, b) => a - b);
  }

  const objectDirect = direct
    .map((entry) =>
      entry && typeof entry === 'object' && Number.isFinite(entry.dtPaintMs)
        ? Number(entry.dtPaintMs)
        : Number.NaN,
    )
    .filter((entry) => Number.isFinite(entry));
  return objectDirect.sort((a, b) => a - b);
};

const writeSummary = async (summary) => {
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
};

const run = async () => {
  let payload;
  try {
    payload = JSON.parse(await readFile(metricsPath, 'utf8'));
  } catch (error) {
    const summary = {
      status: 'skipped',
      reason: 'metrics_not_found',
      metricsPath,
      thresholdMs,
      checkedAt: new Date().toISOString(),
    };
    await writeSummary(summary);
    console.log(`[latency-soft-gate] skipped: metrics file not found at ${metricsPath}`);
    return;
  }

  const samples = parseSamples(payload);
  if (samples.length === 0) {
    const summary = {
      status: 'skipped',
      reason: 'no_samples',
      metricsPath,
      thresholdMs,
      checkedAt: new Date().toISOString(),
    };
    await writeSummary(summary);
    console.log(`[latency-soft-gate] skipped: no numeric latency samples in ${metricsPath}`);
    return;
  }

  const p50Ms = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  const passed = p95Ms <= thresholdMs;
  const summary = {
    status: passed ? 'passed' : 'failed',
    metricsPath,
    thresholdMs,
    sampleCount: samples.length,
    p50Ms,
    p95Ms,
    checkedAt: new Date().toISOString(),
  };
  await writeSummary(summary);

  console.log(
    `[latency-soft-gate] p50=${p50Ms}ms p95=${p95Ms}ms threshold=${thresholdMs}ms samples=${samples.length}`,
  );
  if (!passed) {
    process.exitCode = 1;
  }
};

await run();

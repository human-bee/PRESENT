import fs from 'node:fs/promises';
import path from 'node:path';

const DOCS_ROOT = path.join(process.cwd(), 'docs');
const BENCHMARK_ROOT = path.join(DOCS_ROOT, 'benchmarks', 'canvas-agent');
const LATEST_MANIFEST_PATH = path.join(BENCHMARK_ROOT, 'latest.json');

type UnknownRecord = Record<string, unknown>;

export type BenchmarkMetricSummary = {
  ttfbMs: number | null;
  totalMs: number | null;
  actionCount: number | null;
  retryCount: number | null;
  followupCount: number | null;
  errorCount: number | null;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

export type BenchmarkCountBreakdown = {
  total: number | null;
  byName: Record<string, number>;
};

export type BenchmarkVisualAnalysisView = {
  summary: string | null;
  scoreRationale: string | null;
  strengths: string[];
  issues: string[];
};

export type BenchmarkVariantView = {
  id: string;
  label: string;
  provider: string | null;
  model: string | null;
  priceLabel: string | null;
  accent: string;
};

export type BenchmarkScenarioView = {
  id: string;
  label: string;
  category: string | null;
  description: string | null;
};

export type BenchmarkRunView = {
  id: string;
  scenarioId: string;
  variantId: string;
  comparisonLabel: string | null;
  status: string;
  score: number | null;
  requestedProvider: string | null;
  requestedModel: string | null;
  resolvedProvider: string | null;
  resolvedModel: string | null;
  screenshotHref: string | null;
  screenshotLabel: string | null;
  viewerHref: string | null;
  artifactHref: string | null;
  docHref: string | null;
  metrics: BenchmarkMetricSummary;
  actionSummary: BenchmarkCountBreakdown;
  shapeSummary: BenchmarkCountBreakdown;
  visualAnalysis: BenchmarkVisualAnalysisView;
  notes: string[];
  error: string | null;
  rawMetrics: UnknownRecord | null;
};

export type BenchmarkManifestView = {
  suiteId: string;
  generatedAt: string | null;
  variants: BenchmarkVariantView[];
  scenarios: BenchmarkScenarioView[];
  runs: BenchmarkRunView[];
  summary: {
    totalRuns: number;
    completedRuns: number;
    passRate: number | null;
    averageScore: number | null;
    fastestTtfbMs: number | null;
  };
  sourcePath: string;
};

const ACCENTS = ['#f97316', '#14b8a6', '#facc15', '#38bdf8', '#fb7185', '#a78bfa'];

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const asStringArray = (value: unknown): string[] =>
  asArray(value)
    .map(asString)
    .filter((entry): entry is string => Boolean(entry));

const asNumberRecord = (value: unknown): Record<string, number> => {
  const record = asRecord(value);
  if (!record) return {};
  const normalized: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const numberValue = asNumber(entry);
    if (numberValue !== null) normalized[key] = numberValue;
  }
  return normalized;
};

const readNested = (record: UnknownRecord | null, pathParts: string[]): unknown => {
  let cursor: unknown = record;
  for (const part of pathParts) {
    const next = asRecord(cursor);
    if (!next) return null;
    cursor = next[part];
  }
  return cursor;
};

const readFirstString = (record: UnknownRecord | null, paths: string[][]): string | null => {
  for (const pathParts of paths) {
    const value = asString(readNested(record, pathParts));
    if (value) return value;
  }
  return null;
};

const readFirstNumber = (record: UnknownRecord | null, paths: string[][]): number | null => {
  for (const pathParts of paths) {
    const value = asNumber(readNested(record, pathParts));
    if (value !== null) return value;
  }
  return null;
};

const toAccent = (seed: string) =>
  ACCENTS[Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) % ACCENTS.length] ??
  ACCENTS[0];

const toAssetHref = (input: string | null): string | null => {
  if (!input) return null;
  const absolute = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
  const normalized = path.resolve(absolute);
  const relativePath = path.relative(BENCHMARK_ROOT, normalized);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  const relative = relativePath
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');
  return `/admin/agents/benchmarks/asset/${relative}`;
};

const toViewerHref = (input: string | null): string | null => {
  if (!input) return null;
  return input.startsWith('/') ? input : `/${input.replace(/^\/+/, '')}`;
};

const normalizeVariant = (input: unknown, index: number): BenchmarkVariantView | null => {
  const record = asRecord(input);
  if (!record) return null;
  const id = readFirstString(record, [['id'], ['variantId'], ['key']]) ?? `variant-${index + 1}`;
  const label = readFirstString(record, [['label'], ['name'], ['title']]) ?? id;
  const provider = readFirstString(record, [['provider']]);
  const model = readFirstString(record, [['model'], ['modelId'], ['runtimeModel']]);
  const pricingRecord = asRecord(record.pricing);
  const inputPer1M = readFirstNumber(pricingRecord, [['inputPer1MUsd']]);
  const outputPer1M = readFirstNumber(pricingRecord, [['outputPer1MUsd']]);
  const priceLabel = readFirstString(record, [
    ['priceLabel'],
    ['pricing', 'label'],
    ['pricing', 'display'],
  ]) ??
    (inputPer1M !== null || outputPer1M !== null
      ? `In $${(inputPer1M ?? 0).toFixed(2)} / Out $${(outputPer1M ?? 0).toFixed(2)} per 1M`
      : null);
  return {
    id,
    label,
    provider,
    model,
    priceLabel,
    accent: toAccent(id),
  };
};

const normalizeScenario = (input: unknown, index: number): BenchmarkScenarioView | null => {
  const record = asRecord(input);
  if (!record) return null;
  const id = readFirstString(record, [['id'], ['scenarioId'], ['key']]) ?? `scenario-${index + 1}`;
  const label = readFirstString(record, [['label'], ['name'], ['title']]) ?? id;
  return {
    id,
    label,
    category: readFirstString(record, [['category'], ['group']]),
    description: readFirstString(record, [['description'], ['promptSummary']]),
  };
};

const normalizeRun = (input: unknown, index: number): BenchmarkRunView | null => {
  const record = asRecord(input);
  if (!record) return null;
  const metricsRecord = asRecord(record.metrics);
  const status = readFirstString(record, [['status']]) ?? 'unknown';
  const errorMessage = readFirstString(record, [['error'], ['failure', 'message']]);
  const notes = [
    ...asStringArray(record.notes),
    ...asStringArray(readNested(record, ['summaryNotes'])),
    ...(errorMessage ? [errorMessage] : []),
  ].slice(0, 4);
  return {
    id: readFirstString(record, [['id'], ['runId'], ['attemptId']]) ?? `run-${index + 1}`,
    scenarioId: readFirstString(record, [['scenarioId'], ['scenario', 'id']]) ?? 'unknown-scenario',
    variantId: readFirstString(record, [['variantId'], ['variant', 'id']]) ?? 'unknown-variant',
    status,
    score: readFirstNumber(record, [['score'], ['score', 'overall'], ['grading', 'score']]),
    requestedProvider: readFirstString(record, [['requestedProvider']]) ?? readFirstString(record, [['provider']]),
    requestedModel: readFirstString(record, [['requestedModel']]) ?? readFirstString(record, [['model']]),
    resolvedProvider:
      readFirstString(record, [['resolvedProvider']]) ?? readFirstString(record, [['provider']]),
    resolvedModel: readFirstString(record, [['resolvedModel']]) ?? readFirstString(record, [['model']]),
    screenshotHref: toAssetHref(
      readFirstString(record, [['screenshotPath'], ['paths', 'screenshot'], ['artifacts', 'png']]),
    ),
    screenshotLabel:
      readFirstString(record, [['screenshotLabel'], ['artifacts', 'png']]) ?? 'Final canvas',
    viewerHref: toViewerHref(readFirstString(record, [['viewerPath']])),
    artifactHref: toAssetHref(readFirstString(record, [['artifactPath']])),
    docHref: toAssetHref(readFirstString(record, [['docPath']])),
    metrics: {
      ttfbMs: readFirstNumber(metricsRecord, [['ttfbMs'], ['ttfb'], ['initialTtfbMs']]),
      totalMs: readFirstNumber(metricsRecord, [
        ['totalDurationMs'],
        ['totalMs'],
        ['durationMs'],
        ['latencyMs'],
      ]),
      actionCount: readFirstNumber(metricsRecord, [
        ['totalActionCount'],
        ['actionCount'],
        ['totalActions'],
      ]),
      retryCount: readFirstNumber(metricsRecord, [
        ['totalRetryCount'],
        ['retryCount'],
        ['retries'],
      ]),
      followupCount: readFirstNumber(metricsRecord, [
        ['totalFollowupCount'],
        ['followupCount'],
        ['followups'],
      ]),
      errorCount:
        readFirstNumber(metricsRecord, [['errorCount'], ['errors']]) ??
        (status.toLowerCase() === 'failed' ? 1 : 0),
      totalTokens: readFirstNumber(asRecord(record.usage), [['totalTokens'], ['total_tokens']]),
      inputTokens: readFirstNumber(asRecord(record.usage), [['inputTokens'], ['input_tokens']]),
      outputTokens: readFirstNumber(asRecord(record.usage), [['outputTokens'], ['output_tokens']]),
      costUsd: readFirstNumber(asRecord(record.estimatedCost), [['totalUsd']]),
    },
    actionSummary: {
      total: readFirstNumber(asRecord(record.actionSummary), [['total']]),
      byName: asNumberRecord(asRecord(record.actionSummary)?.byName),
    },
    shapeSummary: {
      total: readFirstNumber(asRecord(record.shapeSummary), [['total']]),
      byName: asNumberRecord(asRecord(record.shapeSummary)?.byType),
    },
    visualAnalysis: {
      summary: readFirstString(asRecord(record.visualAnalysis), [['summary']]),
      scoreRationale: readFirstString(asRecord(record.visualAnalysis), [['scoreRationale']]),
      strengths: asStringArray(asRecord(record.visualAnalysis)?.strengths),
      issues: asStringArray(asRecord(record.visualAnalysis)?.issues),
    },
    comparisonLabel: readFirstString(record, [['comparisonLabel']]),
    notes,
    error: errorMessage,
    rawMetrics: metricsRecord,
  };
};

export async function loadBenchmarkManifest(): Promise<BenchmarkManifestView | null> {
  try {
    const raw = await fs.readFile(LATEST_MANIFEST_PATH, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(
        `Benchmark manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const root = asRecord(parsed);
    if (!root) {
      throw new Error('Benchmark manifest must be a JSON object.');
    }

    const variants = asArray(root.variants)
      .map(normalizeVariant)
      .filter((entry): entry is BenchmarkVariantView => Boolean(entry));
    const runs = asArray(root.runs)
      .map(normalizeRun)
      .filter((entry): entry is BenchmarkRunView => Boolean(entry));
    const scenarios = asArray(root.scenarios)
      .map(normalizeScenario)
      .filter((entry): entry is BenchmarkScenarioView => Boolean(entry));

    const scenarioMap = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const variantMap = new Map(variants.map((variant) => [variant.id, variant]));

    for (const run of runs) {
      if (!scenarioMap.has(run.scenarioId)) {
        scenarioMap.set(run.scenarioId, {
          id: run.scenarioId,
          label: run.scenarioId,
          category: null,
          description: null,
        });
      }
      if (!variantMap.has(run.variantId)) {
        variantMap.set(run.variantId, {
          id: run.variantId,
          label: run.variantId,
          provider: null,
          model: null,
          priceLabel: null,
          accent: toAccent(run.variantId),
        });
      }
    }

    const allScenarios = Array.from(scenarioMap.values());
    const allVariants = Array.from(variantMap.values());
    const completedRuns = runs.filter((run) => run.status.toLowerCase() === 'completed').length;
    const scoredRuns = runs
      .map((run) => run.score)
      .filter((score): score is number => score !== null);
    const ttfbRuns = runs
      .map((run) => run.metrics.ttfbMs)
      .filter((ttfb): ttfb is number => ttfb !== null);

    return {
      suiteId:
        readFirstString(root, [['suiteId'], ['id'], ['benchmarkId']]) ?? 'canvas-agent-benchmark',
      generatedAt: readFirstString(root, [['generatedAt'], ['recordedAt'], ['createdAt']]),
      variants: allVariants,
      scenarios: allScenarios,
      runs,
      summary: {
        totalRuns: runs.length,
        completedRuns,
        passRate: runs.length ? completedRuns / runs.length : null,
        averageScore: scoredRuns.length
          ? scoredRuns.reduce((sum, score) => sum + score, 0) / scoredRuns.length
          : null,
        fastestTtfbMs: ttfbRuns.length ? Math.min(...ttfbRuns) : null,
      },
      sourcePath: LATEST_MANIFEST_PATH,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

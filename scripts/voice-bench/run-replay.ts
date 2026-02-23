import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ReplayUtterance = {
  utteranceId: string;
  speaker: string;
  transcriptText: string;
  referenceText?: string;
  endOfUtteranceMs: number;
  finalTranscriptMs: number;
  cpuPercent?: number;
  recoveryEvent?: boolean;
  errorEvent?: boolean;
};

type BenchmarkResult = {
  generatedAt: string;
  variant: string;
  source: string;
  sampleCount: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  stability: {
    errorEvents: number;
    recoveryEvents: number;
  };
  resource: {
    cpuP95Percent: number | null;
  };
  gate: {
    latencyTargetMs: number;
    latencyPass: boolean;
    stabilityPass: boolean;
    cpuPass: boolean;
    pass: boolean;
  };
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const next = inlineValue ?? args[i + 1];
    if (inlineValue === undefined && typeof next === 'string' && !next.startsWith('--')) {
      map.set(rawKey, next);
      i += 1;
      continue;
    }
    map.set(rawKey, inlineValue ?? 'true');
  }
  return map;
};

const percentile = (values: number[], pct: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
};

const defaultFixture = (): ReplayUtterance[] => {
  const now = Date.now();
  return [
    {
      utteranceId: 'utt-a1',
      speaker: 'speaker-a',
      transcriptText: 'start a five minute timer',
      referenceText: 'start a five minute timer',
      endOfUtteranceMs: now,
      finalTranscriptMs: now + 520,
      cpuPercent: 28,
    },
    {
      utteranceId: 'utt-b1',
      speaker: 'speaker-b',
      transcriptText: 'add a sticky note for budget risks',
      referenceText: 'add a sticky note for budget risks',
      endOfUtteranceMs: now + 2200,
      finalTranscriptMs: now + 2860,
      cpuPercent: 31,
    },
    {
      utteranceId: 'utt-a2',
      speaker: 'speaker-a',
      transcriptText: 'pause the timer',
      referenceText: 'pause the timer',
      endOfUtteranceMs: now + 4100,
      finalTranscriptMs: now + 4720,
      cpuPercent: 29,
      recoveryEvent: true,
    },
  ];
};

const loadCorpus = async (inputPath?: string): Promise<{ source: string; utterances: ReplayUtterance[] }> => {
  if (!inputPath) {
    return {
      source: 'embedded-fixture',
      utterances: defaultFixture(),
    };
  }
  const raw = await readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw) as { utterances?: ReplayUtterance[] } | ReplayUtterance[];
  const utterances = Array.isArray(parsed) ? parsed : parsed.utterances ?? [];
  if (!Array.isArray(utterances) || utterances.length === 0) {
    throw new Error(`No utterances found in ${inputPath}`);
  }
  return {
    source: inputPath,
    utterances,
  };
};

const readBaseline = async (baselinePath?: string): Promise<BenchmarkResult | null> => {
  if (!baselinePath) return null;
  try {
    const raw = await readFile(baselinePath, 'utf8');
    return JSON.parse(raw) as BenchmarkResult;
  } catch {
    return null;
  }
};

const main = async () => {
  const args = parseArgs();
  const variant = args.get('variant') || 'candidate';
  const inputPath = args.get('input');
  const outPath = args.get('out') || path.join('artifacts', 'voice-bench', `${variant}-results.json`);
  const baselinePath = args.get('baseline');

  const { source, utterances } = await loadCorpus(inputPath);
  const baseline = await readBaseline(baselinePath);

  const latencies = utterances
    .map((entry) => Math.max(0, entry.finalTranscriptMs - entry.endOfUtteranceMs))
    .filter((value) => Number.isFinite(value));
  const cpuValues = utterances
    .map((entry) => (typeof entry.cpuPercent === 'number' ? entry.cpuPercent : null))
    .filter((value): value is number => typeof value === 'number');
  const errorEvents = utterances.filter((entry) => entry.errorEvent).length;
  const recoveryEvents = utterances.filter((entry) => entry.recoveryEvent).length;

  const p50Ms = percentile(latencies, 50);
  const p95Ms = percentile(latencies, 95);
  const maxMs = percentile(latencies, 100);
  const cpuP95Percent = cpuValues.length > 0 ? percentile(cpuValues, 95) : null;

  const latencyTargetMs = baseline
    ? Math.max(900, Math.round(baseline.latency.p95Ms * 1.1))
    : 900;
  const latencyPass = p95Ms <= latencyTargetMs;
  const stabilityPass = baseline ? errorEvents <= baseline.stability.errorEvents : errorEvents === 0;
  const cpuPass = (() => {
    if (cpuP95Percent === null) return true;
    if (!baseline || baseline.resource.cpuP95Percent === null) return true;
    return cpuP95Percent <= baseline.resource.cpuP95Percent * 1.15;
  })();

  const result: BenchmarkResult = {
    generatedAt: new Date().toISOString(),
    variant,
    source,
    sampleCount: utterances.length,
    latency: {
      p50Ms,
      p95Ms,
      maxMs,
    },
    stability: {
      errorEvents,
      recoveryEvents,
    },
    resource: {
      cpuP95Percent,
    },
    gate: {
      latencyTargetMs,
      latencyPass,
      stabilityPass,
      cpuPass,
      pass: latencyPass && stabilityPass && cpuPass,
    },
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2));

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.gate.pass) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  process.stderr.write(`[voice-bench] run-replay failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

const loadResult = async (filePath: string): Promise<BenchmarkResult> => {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as BenchmarkResult;
};

const toMd = (result: BenchmarkResult, baseline: BenchmarkResult | null): string => {
  const gate = result.gate.pass ? 'PASS' : 'FAIL';
  const lines: string[] = [
    '# Voice Bench Summary',
    '',
    `- Variant: \`${result.variant}\``,
    `- Generated: \`${result.generatedAt}\``,
    `- Source: \`${result.source}\``,
    `- Samples: \`${result.sampleCount}\``,
    `- Gate: **${gate}**`,
    '',
    '## Latency',
    '',
    `- P50 final transcript latency: \`${result.latency.p50Ms}ms\``,
    `- P95 final transcript latency: \`${result.latency.p95Ms}ms\``,
    `- Max final transcript latency: \`${result.latency.maxMs}ms\``,
    `- Latency target: \`${result.gate.latencyTargetMs}ms\``,
    `- Latency gate: \`${result.gate.latencyPass ? 'pass' : 'fail'}\``,
    '',
    '## Stability',
    '',
    `- Error events: \`${result.stability.errorEvents}\``,
    `- Recovery events: \`${result.stability.recoveryEvents}\``,
    `- Stability gate: \`${result.gate.stabilityPass ? 'pass' : 'fail'}\``,
    '',
    '## Resource',
    '',
    `- CPU P95: \`${result.resource.cpuP95Percent ?? 'n/a'}\``,
    `- CPU gate: \`${result.gate.cpuPass ? 'pass' : 'fail'}\``,
  ];

  if (baseline) {
    lines.push(
      '',
      '## Baseline Comparison',
      '',
      `- Baseline variant: \`${baseline.variant}\``,
      `- Baseline P95 latency: \`${baseline.latency.p95Ms}ms\``,
      `- Baseline error events: \`${baseline.stability.errorEvents}\``,
      `- Baseline CPU P95: \`${baseline.resource.cpuP95Percent ?? 'n/a'}\``,
    );
  }

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const args = parseArgs();
  const resultsPath = args.get('results') || path.join('artifacts', 'voice-bench', 'candidate-results.json');
  const baselinePath = args.get('baseline');
  const summaryPath = args.get('summary') || path.join('artifacts', 'voice-bench', 'summary.md');

  const result = await loadResult(resultsPath);
  const baseline = baselinePath ? await loadResult(baselinePath).catch(() => null) : null;
  const markdown = toMd(result, baseline);

  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, markdown);
  process.stdout.write(markdown);

  if (!result.gate.pass) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  process.stderr.write(`[voice-bench] score-results failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

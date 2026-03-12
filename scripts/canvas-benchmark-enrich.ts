#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import OpenAI from 'openai';
import { renderBenchmarkHtml } from '@/lib/benchmarks/canvas-agent/report-html';
import type {
  BenchmarkManifest,
  BenchmarkShapeSummary,
  BenchmarkVisualAnalysis,
} from '@/lib/benchmarks/canvas-agent/types';

const cwd = process.cwd();
loadEnv({ path: path.join(cwd, '.env.local') });
loadEnv({ path: '/Users/bsteinher/PRESENT/.env.local', override: false });

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.join('=') || '1');
}

const readArg = (key: string, fallback = '') => args.get(key)?.trim() || fallback;
const manifestPath = path.resolve(
  cwd,
  readArg('manifest', 'docs/benchmarks/canvas-agent/latest.json'),
);
const model = readArg('model', 'gpt-4.1-mini');
const limit = Number.parseInt(readArg('limit', '0'), 10) || 0;
const force = ['1', 'true', 'yes'].includes(readArg('force', '').toLowerCase());
const promoteLatest = ['1', 'true', 'yes'].includes(readArg('promoteLatest', '').toLowerCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const summarizeShapes = (shapes: unknown[]): BenchmarkShapeSummary | null => {
  if (!Array.isArray(shapes)) return null;
  const byType: Record<string, number> = {};
  for (const item of shapes) {
    const record = asRecord(item);
    const rawType = typeof record?.type === 'string' ? record.type.trim().toLowerCase() : '';
    const props = asRecord(record?.props);
    const bucket =
      rawType === 'geo'
        ? typeof props?.geo === 'string' && props.geo.trim()
          ? props.geo.trim().toLowerCase()
          : 'box'
        : rawType || 'unknown';
    byType[bucket] = (byType[bucket] ?? 0) + 1;
  }
  return { total: shapes.length, byType };
};

const collectTextCandidates = (response: OpenAI.Responses.Response): string[] => {
  const candidates: string[] = [];
  const direct = (response as any).output_text;
  if (typeof direct === 'string' && direct.trim()) candidates.push(direct.trim());
  const outputItems = Array.isArray((response as any)?.output) ? (response as any).output : [];
  for (const item of outputItems) {
    if (!item || typeof item !== 'object') continue;
    if (typeof (item as any).text === 'string' && (item as any).text.trim()) {
      candidates.push((item as any).text.trim());
    }
    const content = Array.isArray((item as any).content) ? (item as any).content : [];
    for (const chunk of content) {
      if (chunk && typeof chunk.text === 'string' && chunk.text.trim()) {
        candidates.push(chunk.text.trim());
      }
    }
  }
  return candidates;
};

const tryParseJsonCandidate = (candidate: string): any | null => {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  const attempts = [trimmed];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    attempts.push(trimmed.slice(first, last + 1));
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {}
  }
  return null;
};

const coerceVisualAnalysis = (value: unknown): BenchmarkVisualAnalysis | null => {
  const record = asRecord(value);
  if (!record) return null;
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  const scoreRationale =
    typeof record.scoreRationale === 'string' ? record.scoreRationale.trim() : '';
  const strengths = Array.isArray(record.strengths)
    ? record.strengths.filter((entry): entry is string => typeof entry === 'string').slice(0, 2)
    : [];
  const issues = Array.isArray(record.issues)
    ? record.issues.filter((entry): entry is string => typeof entry === 'string').slice(0, 2)
    : [];
  if (!summary && !scoreRationale) return null;
  return {
    summary: summary || 'Visual analysis generated.',
    scoreRationale: scoreRationale || '',
    strengths,
    issues,
  };
};

async function analyzeScreenshot(client: OpenAI, absolutePath: string, run: BenchmarkManifest['runs'][number]) {
  const imageBuffer = await fs.readFile(absolutePath);
  const response = await client.responses.create({
    model,
    max_output_tokens: 320,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'You evaluate TLDraw benchmark screenshots. Return compact JSON with keys summary, scoreRationale, strengths, issues. Keep summary and scoreRationale to one short sentence each. Strengths and issues should be arrays of at most 2 short strings. No markdown.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              `Scenario: ${run.scenarioLabel}`,
              `Variant: ${run.variantLabel}`,
              `Status: ${run.status}`,
              `Score: ${run.score.overall}`,
              `Rubric: ${JSON.stringify(run.score.rubric)}`,
              `Action summary: ${JSON.stringify(run.actionSummary.byName)}`,
              `Shape count: ${run.finalShapeCount}`,
              'Describe what the canvas looks like, then explain why it likely earned this score.',
            ].join('\n'),
          },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${imageBuffer.toString('base64')}`,
          },
        ],
      },
    ],
  });

  for (const candidate of collectTextCandidates(response)) {
    const parsed = tryParseJsonCandidate(candidate);
    const analysis = coerceVisualAnalysis(parsed);
    if (analysis) return analysis;
  }
  throw new Error(`Could not parse visual analysis for ${run.runId}`);
}

async function main() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as BenchmarkManifest;
  const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  const touchedRunArtifacts = new Set<string>();
  let analyzed = 0;

  for (const run of manifest.runs) {
    if (limit > 0 && analyzed >= limit) break;

    const docPath = path.resolve(cwd, run.docPath);
    try {
      if (force || !run.shapeSummary) {
        const doc = JSON.parse(await fs.readFile(docPath, 'utf8')) as { shapes?: unknown[] };
        run.shapeSummary = summarizeShapes(Array.isArray(doc.shapes) ? doc.shapes : []) ?? run.shapeSummary ?? null;
      }
    } catch {}

    const screenshotPath = run.screenshotPath ? path.resolve(cwd, run.screenshotPath) : null;
    if (client && screenshotPath && (force || !run.visualAnalysis)) {
      try {
        run.visualAnalysis = await analyzeScreenshot(client, screenshotPath, run);
        analyzed += 1;
      } catch (error) {
        run.visualAnalysis = {
          summary: 'Visual analysis failed.',
          scoreRationale: error instanceof Error ? error.message : String(error),
          strengths: [],
          issues: ['Analysis pass failed for this artifact.'],
        };
      }
    }

    if (run.artifactPath) {
      const artifactPath = path.resolve(cwd, run.artifactPath);
      try {
        const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as Record<string, unknown>;
        artifact.shapeSummary = run.shapeSummary ?? null;
        artifact.visualAnalysis = run.visualAnalysis ?? null;
        await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
        touchedRunArtifacts.add(artifactPath);
      } catch {}
    }
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const html = renderBenchmarkHtml(manifest);

  const manifestDir = path.dirname(manifestPath);
  const suiteJsonPath = path.join(manifestDir, `${manifest.suiteId}.json`);
  const suiteHtmlPath = path.join(manifestDir, `${manifest.suiteId}.html`);
  const latestJsonPath = path.join(manifestDir, 'latest.json');
  const latestHtmlPath = path.join(manifestDir, 'latest.html');

  if (manifestPath !== suiteJsonPath) {
    await fs.writeFile(suiteJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  await fs.writeFile(suiteHtmlPath, html, 'utf8');
  if (promoteLatest) {
    await fs.writeFile(latestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.writeFile(latestHtmlPath, html, 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        manifest: manifestPath,
        analyzedRuns: analyzed,
        updatedRunArtifacts: touchedRunArtifacts.size,
        promotedLatest: promoteLatest,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[canvas-benchmark-enrich] failed', error);
  process.exit(1);
});

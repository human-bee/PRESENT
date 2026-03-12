#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RoomServiceClient } from 'livekit-server-sdk';
import { runCanvasAgent, type CanvasMetricEventPayload } from '@/lib/agents/canvas-agent/server/runner';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';
import { BENCHMARK_SCENARIOS, BENCHMARK_VARIANTS } from '@/lib/benchmarks/canvas-agent/catalog';
import { scoreBenchmarkRun } from '@/lib/benchmarks/canvas-agent/scoring';
import { renderBenchmarkHtml } from '@/lib/benchmarks/canvas-agent/report-html';
import type {
  BenchmarkActionSummary,
  BenchmarkCostEstimate,
  BenchmarkManifest,
  BenchmarkRun,
  BenchmarkScenario,
  BenchmarkShapeSummary,
  BenchmarkSuiteLifecycle,
  BenchmarkStepResult,
  BenchmarkTokenUsage,
  BenchmarkVariant,
} from '@/lib/benchmarks/canvas-agent/types';
import { loadPresentEnv } from './_env';

const cwd = process.cwd();
loadPresentEnv(cwd);

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.join('=') || '1');
}

const readArg = (key: string, fallback = '') => args.get(key)?.trim() || fallback;
const readBool = (key: string, fallback: boolean) => {
  const raw = args.get(key);
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
};
const readInt = (key: string, fallback: number) => {
  const parsed = Number.parseInt(readArg(key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const BASE_URL = readArg('baseUrl', process.env.PRESENT_BENCHMARK_BASE_URL || 'http://127.0.0.1:3000');
const HEADLESS = readBool('headless', true);
const VIEWER_READY_MS = readInt('viewerReadyMs', 6_000);
const VIEWER_BOOT_TIMEOUT_MS = readInt('viewerBootTimeoutMs', 90_000);
const VIEWER_BOOT_RETRIES = readInt('viewerBootRetries', 3);
const STEP_SETTLE_MS = readInt('stepSettleMs', 1_500);
const SUITE_ID = readArg('suiteId', `canvas-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const PROMOTE_LATEST = readBool('promoteLatest', false);
const ROOT_DIR = path.join(cwd, 'docs', 'benchmarks', 'canvas-agent');
const ASSET_DIR = path.join(ROOT_DIR, 'assets', SUITE_ID);
const JSON_PATH = path.join(ROOT_DIR, `${SUITE_ID}.json`);
const HTML_PATH = path.join(ROOT_DIR, `${SUITE_ID}.html`);
const LATEST_JSON_PATH = path.join(ROOT_DIR, 'latest.json');
const LATEST_HTML_PATH = path.join(ROOT_DIR, 'latest.html');

const scenarioFilter = readArg('scenario')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const variantFilter = readArg('variant')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const selectedScenarios = BENCHMARK_SCENARIOS.filter((scenario) =>
  scenarioFilter.length === 0 ? true : scenarioFilter.includes(scenario.id),
);
const selectedVariants = BENCHMARK_VARIANTS.filter((variant) =>
  variantFilter.length === 0 ? true : variantFilter.includes(variant.id),
);

if (selectedScenarios.length === 0) {
  throw new Error('No matching scenarios selected.');
}
if (selectedVariants.length === 0) {
  throw new Error('No matching variants selected.');
}

const TOTAL_RUN_COUNT = selectedScenarios.length * selectedVariants.length;

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

const PARITY_OWNER_EMAIL = process.env.CANVAS_PARITY_OWNER_EMAIL || 'parity-worker@present.local';
let cachedParityOwnerId: string | null = null;

const requireSupabaseAdmin = () => {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin credentials missing. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return supabaseAdmin;
};

const blankCanvasSnapshot = () => ({
  schemaVersion: 1,
  store: {},
  pages: {},
  assets: {},
  components: {},
});

async function ensureParityOwnerUserId(client: SupabaseClient): Promise<string | null> {
  if (cachedParityOwnerId) return cachedParityOwnerId;
  const adminApi: any = (client as any)?.auth?.admin;
  if (!adminApi || typeof adminApi.createUser !== 'function') return null;
  const getter = typeof adminApi.getUserByEmail === 'function' ? adminApi.getUserByEmail : null;
  if (getter) {
    const { data, error } = await getter.call(adminApi, PARITY_OWNER_EMAIL);
    if (!error && data?.user?.id) {
      cachedParityOwnerId = data.user.id;
      return data.user.id;
    }
  }
  const password = crypto.randomBytes(18).toString('base64url');
  const { data: created, error } = await adminApi.createUser({
    email: PARITY_OWNER_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { role: 'canvas-benchmark' },
  });
  if (error || !created?.user?.id) return null;
  cachedParityOwnerId = created.user.id;
  return created.user.id;
}

async function ensureBenchmarkCanvas(params: { scenario: BenchmarkScenario; variant: BenchmarkVariant; runId: string }) {
  const client = requireSupabaseAdmin();
  const label = `${params.scenario.id}-${params.variant.id}-${params.runId}`;
  const now = new Date().toISOString();
  const { data: existing, error } = await client
    .from('canvases')
    .select('id')
    .eq('name', label)
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;

  let canvasId = existing?.id as string | undefined;
  if (!canvasId) {
    const ownerId = await ensureParityOwnerUserId(client);
    const { data: inserted, error: insertErr } = await client
      .from('canvases')
      .insert({
        user_id: ownerId,
        name: label,
        description: `Canvas benchmark sandbox (${params.scenario.label} / ${params.variant.label}).`,
        document: blankCanvasSnapshot(),
        conversation_key: null,
        is_public: false,
        last_modified: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (insertErr || !inserted?.id) throw insertErr || new Error('Failed to create benchmark canvas');
    canvasId = inserted.id;
  } else {
    await client
      .from('canvases')
      .update({
        document: blankCanvasSnapshot(),
        description: `Canvas benchmark sandbox (${params.scenario.label} / ${params.variant.label}).`,
        name: label,
        last_modified: now,
        updated_at: now,
      })
      .eq('id', canvasId);
  }

  return {
    canvasId,
    canvasName: label,
    roomId: `canvas-${canvasId}`,
  };
}

function resolveLiveKitRestUrl(): string | null {
  const raw =
    process.env.LIVEKIT_REST_URL ||
    process.env.LIVEKIT_URL ||
    process.env.NEXT_PUBLIC_LK_SERVER_URL ||
    process.env.LIVEKIT_HOST;
  if (!raw) return null;
  let url = raw.trim();
  if (url.startsWith('wss://')) url = `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) url = `http://${url.slice(5)}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  return url.replace(/\/+$/, '');
}

async function ensureLiveKitRoom(roomId: string) {
  const restUrl = resolveLiveKitRestUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!restUrl || !apiKey || !apiSecret) {
    throw new Error('LiveKit credentials missing. Configure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.');
  }
  const client = new RoomServiceClient(restUrl, apiKey, apiSecret);
  const existing = await client.listRooms([roomId]);
  if (!existing?.some((room) => room?.name === roomId)) {
    await client.createRoom({ name: roomId, emptyTimeout: 600, maxParticipants: 6 });
  }
}

const mergeActionSummary = (summaries: BenchmarkActionSummary[]): BenchmarkActionSummary => {
  const byName: Record<string, number> = {};
  let total = 0;
  for (const summary of summaries) {
    total += summary.total;
    for (const [name, count] of Object.entries(summary.byName)) {
      byName[name] = (byName[name] ?? 0) + count;
    }
  }
  return { total, byName };
};

const toActionSummary = (actions: Array<{ name?: string }>): BenchmarkActionSummary => {
  const byName: Record<string, number> = {};
  for (const action of actions) {
    const name = typeof action?.name === 'string' ? action.name : 'unknown';
    byName[name] = (byName[name] ?? 0) + 1;
  }
  return {
    total: actions.length,
    byName,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeUsage = (value: unknown): BenchmarkTokenUsage | null => {
  const record = asRecord(value);
  if (!record) return null;
  const inputTokens =
    readNumber(record.inputTokens) ??
    readNumber(record.input_tokens) ??
    readNumber(record.prompt_tokens);
  const outputTokens =
    readNumber(record.outputTokens) ??
    readNumber(record.output_tokens) ??
    readNumber(record.completion_tokens);
  const reasoningTokens =
    readNumber(record.reasoningTokens) ??
    readNumber(record.reasoning_tokens) ??
    readNumber(asRecord(record.output_tokens_details)?.reasoning_tokens);
  const cachedInputTokens =
    readNumber(record.cachedInputTokens) ??
    readNumber(record.cached_input_tokens) ??
    readNumber(asRecord(record.input_tokens_details)?.cached_tokens);
  const totalTokens =
    readNumber(record.totalTokens) ??
    readNumber(record.total_tokens) ??
    ([inputTokens, outputTokens].every((entry) => typeof entry === 'number')
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);

  if (
    inputTokens === null &&
    outputTokens === null &&
    reasoningTokens === null &&
    cachedInputTokens === null &&
    totalTokens === null
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens,
  };
};

const mergeUsage = (items: Array<BenchmarkTokenUsage | null | undefined>): BenchmarkTokenUsage | null => {
  const present = items.filter((item): item is BenchmarkTokenUsage => Boolean(item));
  if (present.length === 0) return null;
  const sumField = (key: keyof BenchmarkTokenUsage) => {
    const values = present
      .map((item) => item[key])
      .filter((value): value is number => typeof value === 'number');
    if (values.length === 0) return null;
    return values.reduce((total, value) => total + value, 0);
  };
  return {
    inputTokens: sumField('inputTokens'),
    outputTokens: sumField('outputTokens'),
    reasoningTokens: sumField('reasoningTokens'),
    cachedInputTokens: sumField('cachedInputTokens'),
    totalTokens: sumField('totalTokens'),
  };
};

const estimateCost = (
  variant: BenchmarkVariant,
  usage: BenchmarkTokenUsage | null,
): BenchmarkCostEstimate | null => {
  if (!usage || !variant.pricing) return null;
  const inputUsd =
    typeof usage.inputTokens === 'number' && typeof variant.pricing.inputPer1MUsd === 'number'
      ? (usage.inputTokens / 1_000_000) * variant.pricing.inputPer1MUsd
      : null;
  const outputUsd =
    typeof usage.outputTokens === 'number' && typeof variant.pricing.outputPer1MUsd === 'number'
      ? (usage.outputTokens / 1_000_000) * variant.pricing.outputPer1MUsd
      : null;
  const totalUsd =
    typeof inputUsd === 'number' || typeof outputUsd === 'number'
      ? (inputUsd ?? 0) + (outputUsd ?? 0)
      : null;
  if (inputUsd === null && outputUsd === null && totalUsd === null) return null;
  return {
    inputUsd,
    outputUsd,
    totalUsd,
    notes: variant.pricing.notes ?? null,
    sourceUrl: variant.pricing.sourceUrl ?? null,
  };
};

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
  return {
    total: shapes.length,
    byType,
  };
};

const buildSummaryRows = (runs: BenchmarkRun[]) =>
  selectedVariants.map((variant) => {
    const variantRuns = runs.filter((run) => run.variantId === variant.id);
    const completed = variantRuns.filter((run) => run.status === 'completed');
    const avgScore =
      completed.length > 0
        ? Math.round(completed.reduce((total, run) => total + run.score.overall, 0) / completed.length)
        : 0;
    const avgDurationMs =
      completed.length > 0
        ? Math.round(completed.reduce((total, run) => total + run.metrics.totalDurationMs, 0) / completed.length)
        : 0;
    const ttfbValues = completed
      .map((run) => run.metrics.initialTtfbMs)
      .filter((value): value is number => typeof value === 'number');
    return {
      variantId: variant.id,
      label: variant.label,
      avgScore,
      avgDurationMs,
      avgTtfbMs:
        ttfbValues.length > 0 ? Math.round(ttfbValues.reduce((total, value) => total + value, 0) / ttfbValues.length) : null,
      successRatePct: variantRuns.length > 0 ? Math.round((completed.length / variantRuns.length) * 100) : 0,
    };
  });

async function writeFileAtomically(filePath: string, contents: string) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, contents, 'utf8');
  await fs.rename(tempPath, filePath);
}

function buildManifest(params: {
  runs: BenchmarkRun[];
  suiteStartedAt: string;
  status: BenchmarkSuiteLifecycle['status'];
  failureMessage?: string | null;
  latestPromotedAt?: string | null;
}): BenchmarkManifest {
  const generatedAt = new Date().toISOString();
  const summaryRows = buildSummaryRows(params.runs);
  return {
    benchmark: 'canvas-agent-benchmark-suite',
    suiteId: SUITE_ID,
    generatedAt,
    baseUrl: BASE_URL,
    executionMode: 'livekit-viewer-direct-runner',
    lifecycle: {
      status: params.status,
      startedAt: params.suiteStartedAt,
      completedAt: params.status === 'running' ? null : generatedAt,
      lastUpdatedAt: generatedAt,
      expectedRuns: TOTAL_RUN_COUNT,
      writtenRuns: params.runs.length,
      promoteLatest: PROMOTE_LATEST,
      latestPromotedAt: params.latestPromotedAt ?? null,
      failureMessage: params.failureMessage ?? null,
    },
    assumptions: [
      'Each run uses a fresh room and canvas to avoid queue and document contention.',
      'The benchmark uses the live viewer plus direct canvas runner path for deterministic screenshot capture.',
      'The GPT-5.4 Low comparison label uses the official OpenAI GPT-5.4 runtime with a lean preset.',
      'Token usage and estimated cost are recorded when the provider returns usage metadata.',
    ],
    variants: selectedVariants,
    scenarios: selectedScenarios,
    runs: params.runs,
    summary: {
      totalRuns: TOTAL_RUN_COUNT,
      completedRuns: params.runs.filter((run) => run.status === 'completed').length,
      successRatePct:
        params.runs.length > 0
          ? Math.round((params.runs.filter((run) => run.status === 'completed').length / params.runs.length) * 100)
          : 0,
      byVariant: summaryRows,
    },
    paths: {
      rootDir: path.relative(cwd, ROOT_DIR),
      assetDir: path.relative(cwd, ASSET_DIR),
      latestJson: path.relative(cwd, LATEST_JSON_PATH),
      latestHtml: path.relative(cwd, LATEST_HTML_PATH),
    },
  };
}

async function writeSuiteSnapshot(
  manifest: BenchmarkManifest,
  options?: { promoteLatest?: boolean },
) {
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const html = renderBenchmarkHtml(manifest);
  await writeFileAtomically(JSON_PATH, json);
  await writeFileAtomically(HTML_PATH, html);
  if (options?.promoteLatest) {
    await writeFileAtomically(LATEST_JSON_PATH, json);
    await writeFileAtomically(LATEST_HTML_PATH, html);
  }
}

async function ensureViewerConnected(page: Page) {
  const bodyText = async () =>
    page.evaluate(() => document.body.innerText || '');

  const clickButtonByText = async (label: string) =>
    page.evaluate((buttonLabel) => {
      const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
        const element = candidate as HTMLButtonElement;
        return element.textContent?.trim() === buttonLabel && !element.disabled;
      });
      if (!button) return false;
      (button as HTMLButtonElement).click();
      return true;
    }, label);

  const initialText = await bodyText();
  if (!initialText.includes('Disconnected')) {
    return;
  }

  const clicked = await clickButtonByText('Connect');
  if (!clicked) {
    throw new Error('Viewer did not expose an enabled Connect button.');
  }

  await page.waitForFunction(
    () => {
      const text = document.body.innerText || '';
      return !text.includes('Disconnected') || text.includes('Connected');
    },
    { timeout: 30_000 },
  );
}

async function waitForViewerShell(page: Page) {
  await page.waitForFunction(
    () => {
      if (document.querySelector('[data-canvas-space="true"]')) return true;
      const text = document.body.innerText || '';
      return text.includes('Transcript') || text.includes('Connect') || text.includes('Connected');
    },
    { timeout: VIEWER_BOOT_TIMEOUT_MS },
  );
}

async function loadViewerWithRetries(page: Page, viewerUrl: string, runId: string) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= VIEWER_BOOT_RETRIES; attempt += 1) {
    try {
      await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForViewerShell(page);
      await page.waitForTimeout(VIEWER_READY_MS);
      await ensureViewerConnected(page);
      await page.waitForTimeout(1_500);
      return;
    } catch (error) {
      lastError = error;
      console.warn('[canvas-benchmark] viewer boot attempt failed', {
        runId,
        attempt,
        maxAttempts: VIEWER_BOOT_RETRIES,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < VIEWER_BOOT_RETRIES) {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(1_000 * attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Viewer boot failed'));
}

async function readViewerCanvasState(page: Page) {
  return page.evaluate(() => {
    const globalWindow = window as typeof window & {
      __present?: { tldrawEditor?: any };
      __present_tldrawEditor?: any;
      __tldrawEditor?: any;
      editor?: any;
    };
    const editor =
      globalWindow.__present?.tldrawEditor ??
      globalWindow.__present_tldrawEditor ??
      globalWindow.__tldrawEditor ??
      globalWindow.editor;
    if (!editor) {
      return { shapeCount: null, shapes: [], snapshotAvailable: false };
    }

    const shapes = typeof editor.getCurrentPageShapesSorted === 'function'
      ? editor.getCurrentPageShapesSorted().map((shape: any) => ({
          id: typeof shape?.id === 'string' ? shape.id : null,
          type: typeof shape?.type === 'string' ? shape.type : null,
          x: typeof shape?.x === 'number' ? shape.x : null,
          y: typeof shape?.y === 'number' ? shape.y : null,
          props:
            shape?.props && typeof shape.props === 'object'
              ? {
                  geo: typeof shape.props.geo === 'string' ? shape.props.geo : null,
                  text:
                    typeof shape.props.text === 'string'
                      ? shape.props.text
                      : typeof shape.props.richText === 'object'
                        ? '[richText]'
                        : null,
                }
              : null,
        }))
      : [];

    return {
      shapeCount: shapes.length,
      shapes,
      snapshotAvailable: typeof editor.getSnapshot === 'function',
    };
  });
}

async function runStep(params: {
  roomId: string;
  variant: BenchmarkVariant;
  step: BenchmarkScenario['steps'][number];
}): Promise<BenchmarkStepResult> {
  const actionLog: Array<{ name?: string }> = [];
  const metricEvents: Array<Record<string, unknown>> = [];
  const usageSnapshots: BenchmarkTokenUsage[] = [];
  const startedAt = Date.now();
  let sessionId: string | null = null;
  let latestComplete: CanvasMetricEventPayload | null = null;
  let latestTtfb: CanvasMetricEventPayload | null = null;
  let runtimeIdentity: BenchmarkStepResult['runtime'] = null;

  try {
    await runCanvasAgent({
      roomId: params.roomId,
      userMessage: params.step.message,
      model: params.variant.model,
      contextProfile: params.variant.execution.contextProfile,
      hooks: {
        onActions: (payload) => {
          sessionId = payload.sessionId;
          actionLog.push(...payload.actions);
        },
        onMetricEvent: (payload) => {
          sessionId = payload.sessionId;
          metricEvents.push(payload);
          if (payload.event === 'ttfb') latestTtfb = payload;
          if (payload.event === 'complete') latestComplete = payload;
        },
        onModelTelemetry: (payload) => {
          sessionId = payload.sessionId;
          const normalized = normalizeUsage(payload.usage);
          if (normalized) usageSnapshots.push(normalized);
          runtimeIdentity = {
            provider: payload.provider,
            model: payload.model,
            phase: payload.phase,
          };
        },
      },
      configOverrides: {
        ...(params.variant.execution.configOverrides ?? {}),
        debug: false,
      },
    });

    return {
      stepId: params.step.id,
      label: params.step.label,
      sessionId,
      status: 'completed',
      actionSummary: toActionSummary(actionLog),
      runtime: runtimeIdentity,
      metrics: {
        durationMs: Date.now() - startedAt,
        ttfbMs: typeof latestTtfb?.ttfb === 'number' ? (latestTtfb.ttfb as number) : null,
        actionCount: typeof latestComplete?.actionCount === 'number' ? (latestComplete.actionCount as number) : null,
        mutatingActionCount:
          typeof latestComplete?.mutatingActionCount === 'number'
            ? (latestComplete.mutatingActionCount as number)
            : null,
        followupCount:
          typeof latestComplete?.followupCount === 'number' ? (latestComplete.followupCount as number) : null,
        retryCount: typeof latestComplete?.retryCount === 'number' ? (latestComplete.retryCount as number) : null,
        firstAckMs:
          typeof latestComplete?.first_ack_ms === 'number' ? (latestComplete.first_ack_ms as number) : null,
        screenshotRttMs:
          typeof latestComplete?.rtt === 'number'
            ? (latestComplete.rtt as number)
            : metricEvents
                .find((event) => event.event === 'screenshot' && typeof event.rtt === 'number')
                ?.rtt as number | null | undefined,
        screenshotResult:
          typeof latestComplete?.result === 'string'
            ? (latestComplete.result as string)
            : typeof metricEvents.at(-1)?.result === 'string'
              ? (metricEvents.at(-1)?.result as string)
              : null,
        usage: mergeUsage(usageSnapshots),
        estimatedCostUsd: estimateCost(params.variant, mergeUsage(usageSnapshots))?.totalUsd ?? null,
      },
      metricEvents,
    };
  } catch (error) {
    return {
      stepId: params.step.id,
      label: params.step.label,
      sessionId,
      status: 'failed',
      actionSummary: toActionSummary(actionLog),
      runtime: runtimeIdentity,
      metrics: {
        durationMs: Date.now() - startedAt,
        ttfbMs: typeof latestTtfb?.ttfb === 'number' ? (latestTtfb.ttfb as number) : null,
        usage: mergeUsage(usageSnapshots),
        estimatedCostUsd: estimateCost(params.variant, mergeUsage(usageSnapshots))?.totalUsd ?? null,
      },
      metricEvents,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  await fs.mkdir(ASSET_DIR, { recursive: true });
  await fs.mkdir(ROOT_DIR, { recursive: true });

  const suiteStartedAt = new Date().toISOString();
  const manifestRuns: BenchmarkRun[] = [];
  let browser: Browser | null = null;

  const flushSnapshot = async (
    status: BenchmarkSuiteLifecycle['status'],
    options?: { promoteLatest?: boolean; failureMessage?: string | null },
  ) => {
    const manifest = buildManifest({
      runs: manifestRuns,
      suiteStartedAt,
      status,
      failureMessage: options?.failureMessage ?? null,
      latestPromotedAt: options?.promoteLatest ? new Date().toISOString() : null,
    });
    await writeSuiteSnapshot(manifest, { promoteLatest: options?.promoteLatest });
    return manifest;
  };

  await flushSnapshot('running');

  let fatalError: unknown = null;
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    for (const scenario of selectedScenarios) {
      for (const variant of selectedVariants) {
        const runId = `${scenario.id}-${variant.id}-${Date.now().toString(36)}`;
        const { roomId, canvasId, canvasName } = await ensureBenchmarkCanvas({ scenario, variant, runId });
        const viewerPath = `/canvas?room=${roomId}&id=${canvasId}&parity=1`;
        const viewerUrl = `${BASE_URL}${viewerPath}`;
        const runStartedAt = new Date().toISOString();
        const screenshotPath = path.join(ASSET_DIR, `${scenario.id}__${variant.id}.png`);
        const runArtifactPath = path.join(ASSET_DIR, `${scenario.id}__${variant.id}.json`);
        const docPath = path.join(ASSET_DIR, `${scenario.id}__${variant.id}-doc.json`);
        const stepResults: BenchmarkStepResult[] = [];
        let page: Page | null = null;

        try {
          await ensureLiveKitRoom(roomId);
          page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
          await loadViewerWithRetries(page, viewerUrl, runId);
          for (const step of scenario.steps) {
            const result = await runStep({ roomId, variant, step });
            stepResults.push(result);
            await page.waitForTimeout(STEP_SETTLE_MS);
            if (result.status === 'failed') {
              break;
            }
          }

          await page.screenshot({ path: screenshotPath, fullPage: true });
          const viewerCanvasState = await readViewerCanvasState(page);
          const persistedDoc = (await getCanvasShapeSummary(roomId)) ?? { shapes: [] };
          const doc = {
            roomId,
            canvasId,
            canvasName,
            source: viewerCanvasState.shapeCount !== null ? 'viewer' : 'persisted',
            shapeCount:
              typeof viewerCanvasState.shapeCount === 'number'
                ? viewerCanvasState.shapeCount
                : Array.isArray((persistedDoc as any)?.shapes)
                  ? (persistedDoc as any).shapes.length
                  : 0,
            shapes:
              viewerCanvasState.shapeCount !== null ? viewerCanvasState.shapes : (persistedDoc as any)?.shapes ?? [],
            persisted: persistedDoc,
          };
          await fs.writeFile(docPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

          const actionSummary = mergeActionSummary(stepResults.map((step) => step.actionSummary));
          const usage = mergeUsage(stepResults.map((step) => step.metrics.usage));
          const estimatedCost = estimateCost(variant, usage);
          const shapeSummary = summarizeShapes(Array.isArray(doc.shapes) ? doc.shapes : []);
          const totalDurationMs = stepResults.reduce((total, step) => total + step.metrics.durationMs, 0);
          const totalMutatingActionCount = stepResults.reduce(
            (total, step) => total + (step.metrics.mutatingActionCount ?? 0),
            0,
          );
          const totalFollowupCount = stepResults.reduce((total, step) => total + (step.metrics.followupCount ?? 0), 0);
          const totalRetryCount = stepResults.reduce((total, step) => total + (step.metrics.retryCount ?? 0), 0);
          const initialTtfbMs = stepResults.find((step) => typeof step.metrics.ttfbMs === 'number')?.metrics.ttfbMs ?? null;
          const ackValues = stepResults
            .map((step) => step.metrics.firstAckMs)
            .filter((value): value is number => typeof value === 'number');
          const screenshotValues = stepResults
            .map((step) => step.metrics.screenshotRttMs)
            .filter((value): value is number => typeof value === 'number');
          const resolvedRuntime =
            [...stepResults]
              .reverse()
              .map((step) => step.runtime)
              .find((runtime) => runtime?.model || runtime?.provider) ?? null;

          const runBase: BenchmarkRun = {
            runId,
            scenarioId: scenario.id,
            variantId: variant.id,
            scenarioLabel: scenario.label,
            variantLabel: variant.label,
            comparisonLabel: variant.comparisonLabel,
            category: scenario.category,
            startedAt: runStartedAt,
            completedAt: new Date().toISOString(),
            status: stepResults.some((step) => step.status === 'failed') ? 'failed' : 'completed',
            requestedProvider: variant.provider,
            requestedModel: variant.model,
            resolvedProvider: resolvedRuntime?.provider ?? variant.provider,
            resolvedModel: resolvedRuntime?.model ?? variant.model,
            roomId,
            canvasId,
            canvasName,
            viewerPath,
            screenshotPath: path.relative(cwd, screenshotPath),
            artifactPath: path.relative(cwd, runArtifactPath),
            docPath: path.relative(cwd, docPath),
            finalShapeCount: typeof doc.shapeCount === 'number' ? doc.shapeCount : 0,
            actionSummary,
            shapeSummary,
            metrics: {
              totalDurationMs,
              initialTtfbMs,
              totalActionCount: actionSummary.total,
              totalMutatingActionCount,
              totalFollowupCount,
              totalRetryCount,
              avgFirstAckMs:
                ackValues.length > 0 ? Math.round(ackValues.reduce((total, value) => total + value, 0) / ackValues.length) : null,
              avgScreenshotRttMs:
                screenshotValues.length > 0
                  ? Math.round(screenshotValues.reduce((total, value) => total + value, 0) / screenshotValues.length)
                  : null,
            },
            usage,
            estimatedCost,
            provider: resolvedRuntime?.provider ?? variant.provider,
            model: resolvedRuntime?.model ?? variant.model,
            visualAnalysis: null,
            steps: stepResults,
            score: {
              overall: 0,
              grade: 'weak',
              rubric: { shapes: 0, requiredVerbs: 0, preferredVerbs: 0, screenshot: 0, stability: 0 },
              notes: [],
            },
            ...(stepResults.some((step) => step.status === 'failed')
              ? {
                  status: 'failed' as const,
                  error: stepResults.find((step) => step.status === 'failed')?.error ?? 'Benchmark step failed.',
                }
              : null),
          };

          runBase.score = scoreBenchmarkRun(scenario, runBase);
          await fs.writeFile(runArtifactPath, `${JSON.stringify(runBase, null, 2)}\n`, 'utf8');
          manifestRuns.push(runBase);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await page?.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
          const doc = {
            roomId,
            canvasId,
            canvasName,
            source: 'unavailable',
            shapeCount: 0,
            shapes: [],
            persisted: null,
          };
          await fs.writeFile(docPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

          const actionSummary = mergeActionSummary(stepResults.map((step) => step.actionSummary));
          const usage = mergeUsage(stepResults.map((step) => step.metrics.usage));
          const estimatedCost = estimateCost(variant, usage);
          const resolvedRuntime =
            [...stepResults]
              .reverse()
              .map((step) => step.runtime)
              .find((runtime) => runtime?.model || runtime?.provider) ?? null;
          const failedRun: BenchmarkRun = {
            runId,
            scenarioId: scenario.id,
            variantId: variant.id,
            scenarioLabel: scenario.label,
            variantLabel: variant.label,
            comparisonLabel: variant.comparisonLabel,
            category: scenario.category,
            startedAt: runStartedAt,
            completedAt: new Date().toISOString(),
            status: 'failed',
            requestedProvider: variant.provider,
            requestedModel: variant.model,
            resolvedProvider: resolvedRuntime?.provider ?? variant.provider,
            resolvedModel: resolvedRuntime?.model ?? variant.model,
            roomId,
            canvasId,
            canvasName,
            viewerPath,
            screenshotPath: path.relative(cwd, screenshotPath),
            artifactPath: path.relative(cwd, runArtifactPath),
            docPath: path.relative(cwd, docPath),
            finalShapeCount: 0,
            actionSummary,
            shapeSummary: { total: 0, byType: {} },
            metrics: {
              totalDurationMs: stepResults.reduce((total, step) => total + step.metrics.durationMs, 0),
              initialTtfbMs:
                stepResults.find((step) => typeof step.metrics.ttfbMs === 'number')?.metrics.ttfbMs ?? null,
              totalActionCount: actionSummary.total,
              totalMutatingActionCount: stepResults.reduce(
                (total, step) => total + (step.metrics.mutatingActionCount ?? 0),
                0,
              ),
              totalFollowupCount: stepResults.reduce((total, step) => total + (step.metrics.followupCount ?? 0), 0),
              totalRetryCount: stepResults.reduce((total, step) => total + (step.metrics.retryCount ?? 0), 0),
              avgFirstAckMs: null,
              avgScreenshotRttMs: null,
            },
            usage,
            estimatedCost,
            provider: resolvedRuntime?.provider ?? variant.provider,
            model: resolvedRuntime?.model ?? variant.model,
            visualAnalysis: null,
            steps: stepResults,
            score: {
              overall: 0,
              grade: 'weak',
              rubric: { shapes: 0, requiredVerbs: 0, preferredVerbs: 0, screenshot: 0, stability: 0 },
              notes: [errorMessage],
            },
            error: errorMessage,
          };
          await fs.writeFile(runArtifactPath, `${JSON.stringify(failedRun, null, 2)}\n`, 'utf8');
          manifestRuns.push(failedRun);
        } finally {
          await page?.close().catch(() => {});
        }

        await flushSnapshot('running');
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    await browser?.close().catch(() => {});
  }

  if (fatalError) {
    await flushSnapshot('failed', {
      promoteLatest: PROMOTE_LATEST,
      failureMessage: fatalError instanceof Error ? fatalError.message : String(fatalError),
    });
    throw fatalError;
  }

  const manifest = await flushSnapshot('completed', { promoteLatest: PROMOTE_LATEST });

  console.log(JSON.stringify({
    suiteId: SUITE_ID,
    status: manifest.lifecycle.status,
    runs: manifest.runs.length,
    json: path.relative(cwd, JSON_PATH),
    html: path.relative(cwd, HTML_PATH),
    promotedLatest: PROMOTE_LATEST,
  }, null, 2));
}

main().catch((error) => {
  console.error('[canvas-benchmark] failed', error);
  process.exit(1);
});

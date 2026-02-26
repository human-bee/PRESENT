import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

try {
  config({ path: path.join(process.cwd(), '.env.local') });
} catch {}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const PROOF_DIR =
  process.env.MCP_TIMELINE_PROOF_DIR ||
  path.join(process.cwd(), 'docs', 'proof-artifacts', 'mcp-timeline-proof');
const VIDEO_DIR = path.join(PROOF_DIR, 'video-temp');
const VIDEO_OUTPUT = path.join(PROOF_DIR, 'mcp-timeline-widget-demo.webm');
const TRACE_REPORT_OUTPUT = path.join(PROOF_DIR, 'agent-trace-report.html');
const TRACE_JSON_OUTPUT = path.join(PROOF_DIR, 'agent-trace-report.json');
const SCORECARD_COMPONENT_ID = 'scorecard-mcp-timeline-proof';
const WIDGET_COMPONENT_ID = 'mcp-timeline-widget-proof';

type TaskRow = {
  id: string;
  room: string | null;
  task: string | null;
  status: string | null;
  attempt: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
  request_id: string | null;
  trace_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TraceEventRow = {
  id: string;
  trace_id: string | null;
  task_id: string | null;
  task: string | null;
  stage: string | null;
  status: string | null;
  latency_ms: number | null;
  created_at: string | null;
  payload: Record<string, unknown> | null;
};

type TaskValidation = {
  status: 'ok' | 'warning';
  message?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const escapeHtml = (input: unknown) =>
  String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function executeToolCall(page: Page, tool: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ tool, params }) => {
      const execute = (window as any).__presentToolDispatcherExecute;
      if (typeof execute !== 'function') {
        throw new Error('window.__presentToolDispatcherExecute is not available');
      }
      const call = {
        id: `pw-${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'tool_call' as const,
        payload: { tool, params },
        timestamp: Date.now(),
        source: 'playwright',
      };
      return await execute(call);
    },
    { tool, params },
  );
}

async function waitForCanvasRoom(page: Page): Promise<{ canvasId: string; room: string }> {
  await page.waitForFunction(() => {
    const id = new URL(window.location.href).searchParams.get('id');
    return typeof id === 'string' && id.trim().length > 0;
  });
  const canvasId = await page.evaluate(
    () => new URL(window.location.href).searchParams.get('id') || '',
  );
  if (!canvasId) {
    throw new Error('Canvas id was not resolved in URL');
  }
  return { canvasId, room: `canvas-${canvasId}` };
}

async function dispatchScorecardRun(
  page: Page,
  room: string,
  componentId: string,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ room, componentId }) => {
      const response = await fetch('/api/steward/runScorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          componentId,
          task: 'scorecard.patch',
          topic: 'MCP timeline proof run',
          summary: 'Apply deterministic scorecard patch for timeline sync proof.',
          claimPatches: [
            {
              op: 'upsert',
              id: 'AFF-1',
              side: 'AFF',
              speech: '1AC',
              quote: 'MCP timeline sync should mirror canonical scorecard updates.',
              summary: 'Deterministic proof claim inserted by capture script.',
              status: 'VERIFIED',
              verdict: 'ACCURATE',
              impact: 'MAJOR',
            },
          ],
          requestId: `proof-${Date.now()}`,
        }),
      });
      let payload: Record<string, unknown> = {};
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    },
    { room, componentId },
  );
}

async function dispatchCanvasRun(
  page: Page,
  room: string,
): Promise<Record<string, unknown>> {
  return page.evaluate(async ({ room }) => {
    const response = await fetch('/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room,
        task: 'canvas.agent_prompt',
        message: 'Draw one sticky note that says "MCP timeline sync verified".',
        requestId: `canvas-proof-${Date.now()}`,
        traceId: `canvas-proof-trace-${Date.now()}`,
      }),
    });
    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  }, { room });
}

function extractTaskId(runResponse: Record<string, unknown>): string | null {
  const payload = runResponse.payload as Record<string, unknown> | undefined;
  const task = payload?.task as Record<string, unknown> | undefined;
  const id = task?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

function requireQueuedRun(label: string, runResponse: Record<string, unknown>): string {
  const ok = runResponse.ok === true;
  const statusCode = Number(runResponse.status ?? 0);
  const taskId = extractTaskId(runResponse);
  if (!ok || statusCode !== 202 || !taskId) {
    throw new Error(
      `${label} dispatch did not enqueue a task (ok=${String(
        runResponse.ok,
      )}, status=${String(runResponse.status)}, taskId=${String(taskId)})`,
    );
  }
  return taskId;
}

function requireSucceededTask(
  label: string,
  task: TaskRow | null,
  options?: { allowedErrorPatterns?: RegExp[] },
): TaskValidation {
  if (!task || task.status !== 'succeeded') {
    throw new Error(
      `${label} task did not succeed (status=${task?.status ?? 'missing'}, id=${task?.id ?? 'missing'})`,
    );
  }
  const errorText = typeof task.error === 'string' ? task.error.trim() : '';
  if (!errorText) {
    return { status: 'ok' };
  }
  const allowed = options?.allowedErrorPatterns?.some((pattern) => pattern.test(errorText));
  if (allowed) {
    return {
      status: 'warning',
      message: `${label} task returned non-fatal warning: ${errorText}`,
    };
  }
  throw new Error(`${label} task succeeded with unexpected error: ${errorText}`);
}

async function waitForTaskCompletion(
  supabase: SupabaseClient,
  taskId: string,
  timeoutMs = 90_000,
): Promise<TaskRow> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const queryTask = async (includeTraceId: boolean) =>
      supabase
        .from('agent_tasks')
        .select(
          includeTraceId
            ? 'id,room,task,status,attempt,error,result,request_id,trace_id,created_at,updated_at'
            : 'id,room,task,status,attempt,error,result,request_id,created_at,updated_at',
        )
        .eq('id', taskId)
        .maybeSingle();

    let includeTraceId = true;
    let { data, error } = await queryTask(includeTraceId);
    if (
      error &&
      typeof error.message === 'string' &&
      /column\s+agent_tasks\.trace_id\s+does not exist/i.test(error.message)
    ) {
      includeTraceId = false;
      const fallback = await queryTask(includeTraceId);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      throw new Error(`Failed reading task ${taskId}: ${error.message}`);
    }
    if (data) {
      const task = {
        ...(data as Record<string, unknown>),
        trace_id: includeTraceId ? (data as Record<string, unknown>).trace_id ?? null : null,
      } as TaskRow;
      if (
        task.status === 'succeeded' ||
        task.status === 'failed' ||
        task.status === 'cancelled'
      ) {
        return task;
      }
    }
    await sleep(1200);
  }
  throw new Error(`Timed out waiting for task completion: ${taskId}`);
}

async function resolveTraceId(
  supabase: SupabaseClient,
  task: TaskRow,
): Promise<string | null> {
  if (typeof task.trace_id === 'string' && task.trace_id.trim().length > 0) {
    return task.trace_id.trim();
  }
  const byTask = await supabase
    .from('agent_trace_events')
    .select('trace_id')
    .eq('task_id', task.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!byTask.error && byTask.data?.trace_id) {
    return String(byTask.data.trace_id);
  }
  if (typeof task.request_id === 'string' && task.request_id.trim().length > 0) {
    const byRequest = await supabase
      .from('agent_trace_events')
      .select('trace_id')
      .eq('request_id', task.request_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!byRequest.error && byRequest.data?.trace_id) {
      return String(byRequest.data.trace_id);
    }
  }
  return null;
}

async function loadTraceEvents(
  supabase: SupabaseClient,
  traceId: string,
): Promise<TraceEventRow[]> {
  const { data, error } = await supabase
    .from('agent_trace_events')
    .select('id,trace_id,task_id,task,stage,status,latency_ms,created_at,payload')
    .eq('trace_id', traceId)
    .order('created_at', { ascending: true })
    .limit(2_000);
  if (error) {
    throw new Error(`Failed reading trace events for ${traceId}: ${error.message}`);
  }
  return (data || []) as TraceEventRow[];
}

async function loadTaskScopedEvents(
  supabase: SupabaseClient,
  taskId: string,
): Promise<TraceEventRow[]> {
  const { data, error } = await supabase
    .from('agent_trace_events')
    .select('id,trace_id,task_id,task,stage,status,latency_ms,created_at,payload')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .limit(2_000);
  if (error) {
    throw new Error(`Failed reading task-scoped events for ${taskId}: ${error.message}`);
  }
  return (data || []) as TraceEventRow[];
}

function buildTraceReportHtml(args: {
  generatedAt: string;
  baseUrl: string;
  room: string;
  scorecardComponentId: string;
  widgetComponentId: string;
  runResponses: {
    scorecard: Record<string, unknown>;
    canvas: Record<string, unknown>;
  };
  scorecardTask: TaskRow;
  taskValidations: {
    scorecard: TaskValidation;
    canvas: TaskValidation;
  };
  sync: {
    confirmed: boolean;
    rowCount: number;
  };
  traceTaskSource: 'canvas' | 'scorecard';
  task: TaskRow | null;
  traceId: string | null;
  events: TraceEventRow[];
}) {
  const rows = args.events
    .map((event, index) => {
      const payloadJson = escapeHtml(JSON.stringify(event.payload ?? {}, null, 2));
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(event.created_at)}</td>
          <td>${escapeHtml(event.stage)}</td>
          <td>${escapeHtml(event.status)}</td>
          <td>${escapeHtml(event.task)}</td>
          <td>${escapeHtml(event.latency_ms)}</td>
          <td><details><summary>payload</summary><pre>${payloadJson}</pre></details></td>
        </tr>
      `;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MCP Timeline Proof Trace Report</title>
    <style>
      body { margin: 0; padding: 24px; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #12212b; background: #f2f6f8; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      .meta { margin: 0 0 20px; color: #355061; }
      .card { background: #fff; border: 1px solid #d8e2e8; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(10, 20, 30, 0.05); }
      .grid { display: grid; grid-template-columns: 220px 1fr; gap: 8px 16px; }
      .label { color: #5d7888; font-weight: 600; }
      pre { margin: 8px 0 0; padding: 10px; background: #0f2029; color: #d8ecf7; border-radius: 8px; overflow: auto; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #e2eaef; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f8fbfd; position: sticky; top: 0; z-index: 1; }
      details summary { cursor: pointer; color: #0f5170; }
    </style>
  </head>
  <body>
    <h1>MCP Timeline Widget Proof</h1>
    <p class="meta">Generated at ${escapeHtml(args.generatedAt)}</p>
    <section class="card">
      <h2>Run Summary</h2>
      <div class="grid">
        <div class="label">Base URL</div><div>${escapeHtml(args.baseUrl)}</div>
        <div class="label">Room</div><div>${escapeHtml(args.room)}</div>
        <div class="label">Scorecard Component</div><div>${escapeHtml(args.scorecardComponentId)}</div>
        <div class="label">Widget Component</div><div>${escapeHtml(args.widgetComponentId)}</div>
        <div class="label">Trace Source</div><div>${escapeHtml(args.traceTaskSource)}</div>
        <div class="label">Task ID</div><div>${escapeHtml(args.task?.id ?? '--')}</div>
        <div class="label">Task Name</div><div>${escapeHtml(args.task?.task ?? '--')}</div>
        <div class="label">Task Status</div><div>${escapeHtml(args.task?.status ?? '--')}</div>
        <div class="label">Trace ID</div><div>${escapeHtml(args.traceId ?? '--')}</div>
        <div class="label">Trace Events</div><div>${args.events.length}</div>
        <div class="label">Scorecard Task</div><div>${escapeHtml(args.scorecardTask.id)} (${escapeHtml(args.scorecardTask.status ?? '--')})</div>
        <div class="label">Scorecard Validation</div><div>${escapeHtml(args.taskValidations.scorecard.status)}${args.taskValidations.scorecard.message ? ` · ${escapeHtml(args.taskValidations.scorecard.message)}` : ''}</div>
        <div class="label">Canvas Validation</div><div>${escapeHtml(args.taskValidations.canvas.status)}${args.taskValidations.canvas.message ? ` · ${escapeHtml(args.taskValidations.canvas.message)}` : ''}</div>
        <div class="label">Timeline Sync</div><div>${args.sync.confirmed ? `confirmed (${args.sync.rowCount} rows)` : 'not confirmed'}</div>
      </div>
    </section>
    <section class="card">
      <h2>runScorecard Response</h2>
      <pre>${escapeHtml(JSON.stringify(args.runResponses.scorecard, null, 2))}</pre>
    </section>
    <section class="card">
      <h2>runCanvas Response</h2>
      <pre>${escapeHtml(JSON.stringify(args.runResponses.canvas, null, 2))}</pre>
    </section>
    <section class="card">
      <h2>Task Row</h2>
      <pre>${escapeHtml(JSON.stringify(args.task ?? null, null, 2))}</pre>
    </section>
    <section class="card">
      <h2>Trace Events</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>created_at</th>
            <th>stage</th>
            <th>status</th>
            <th>task</th>
            <th>latency_ms</th>
            <th>payload</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7">No trace events found.</td></tr>'}
        </tbody>
      </table>
    </section>
  </body>
</html>`;
}

async function main() {
  ensureDir(PROOF_DIR);
  ensureDir(VIDEO_DIR);

  const supabase = getSupabaseAdmin();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/canvas?fresh=1`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForSelector('.tl-container', { state: 'visible', timeout: 180_000 });
  await page.waitForFunction(
    () => typeof (window as any).__presentToolDispatcherExecute === 'function',
    null,
    { timeout: 120_000 },
  );

  const { room } = await waitForCanvasRoom(page);

  await executeToolCall(page, 'create_component', {
    type: 'DebateScorecard',
    messageId: SCORECARD_COMPONENT_ID,
    spec: {
      topic: 'MCP Timeline Proof',
      round: 'Round 1',
      componentId: SCORECARD_COMPONENT_ID,
    },
  });

  await executeToolCall(page, 'create_component', {
    type: 'McpAppWidget',
    messageId: WIDGET_COMPONENT_ID,
    spec: {
      title: 'MCP Timeline',
      resourceUri: '/mcp-apps/timeline.html',
      syncTimeline: true,
      syncRoom: room,
      syncComponentId: SCORECARD_COMPONENT_ID,
      syncIntervalMs: 1200,
      autoRun: false,
      displayMode: 'inline',
    },
  });

  await page.waitForSelector(`iframe[title="MCP Timeline"]`, {
    state: 'visible',
    timeout: 120_000,
  });

  const runResponse = await dispatchScorecardRun(page, room, SCORECARD_COMPONENT_ID);
  const canvasRunResponse = await dispatchCanvasRun(page, room);
  const scorecardTaskId = requireQueuedRun('runScorecard', runResponse);
  const canvasTaskId = requireQueuedRun('runCanvas', canvasRunResponse);

  const scorecardTask = await waitForTaskCompletion(supabase, scorecardTaskId);
  const scorecardTaskValidation = requireSucceededTask('runScorecard', scorecardTask);

  const canvasTask = await waitForTaskCompletion(supabase, canvasTaskId);
  const canvasTaskValidation = requireSucceededTask('runCanvas', canvasTask, {
    allowedErrorPatterns: [/^LiveKit room not found before timeout:/i],
  });
  if (canvasTaskValidation.status === 'warning' && canvasTaskValidation.message) {
    console.warn(`[proof] ${canvasTaskValidation.message}`);
  }

  let task: TaskRow | null = canvasTask;
  let traceId: string | null = null;
  let traceEvents: TraceEventRow[] = [];
  const traceTaskSource: 'canvas' | 'scorecard' = 'canvas';

  traceId = await resolveTraceId(supabase, canvasTask);
  if (traceId) {
    traceEvents = await loadTraceEvents(supabase, traceId);
  } else {
    traceEvents = await loadTaskScopedEvents(supabase, canvasTask.id);
    if (traceEvents.length > 0) {
      traceId = `task:${canvasTask.id}`;
    }
  }
  if (!traceId || traceEvents.length === 0) {
    throw new Error(
      `Trace evidence missing for canvas task ${canvasTask.id} (traceId=${String(traceId)}, events=${traceEvents.length})`,
    );
  }

  const frameLocator = page.frameLocator('iframe[title="MCP Timeline"]');
  await frameLocator.locator('#topic').waitFor({ state: 'visible', timeout: 60_000 });

  const syncStart = Date.now();
  let syncConfirmed = false;
  let syncedRowCount = 0;
  while (!syncConfirmed && Date.now() - syncStart < 60_000) {
    const topicText = (await frameLocator.locator('#topic').textContent()) || '';
    const rowCount = await frameLocator.locator('.row').count();
    syncedRowCount = rowCount;
    if (!topicText.includes('Waiting for scorecard sync') && rowCount > 0) {
      syncConfirmed = true;
      break;
    }
    await sleep(1_000);
  }
  if (!syncConfirmed) {
    throw new Error('Timeline widget did not confirm scorecard sync within timeout.');
  }
  await page.waitForTimeout(4_000);

  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  if (!videoPath) {
    throw new Error('Playwright did not produce a video path');
  }

  fs.copyFileSync(videoPath, VIDEO_OUTPUT);
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });

  const reportPayload = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    room,
    scorecardComponentId: SCORECARD_COMPONENT_ID,
    widgetComponentId: WIDGET_COMPONENT_ID,
    runResponse,
    canvasRunResponse,
    scorecardTask,
    scorecardTaskValidation,
    canvasTaskValidation,
    syncConfirmed,
    syncedRowCount,
    traceTaskSource,
    task,
    traceId,
    traceEvents,
  };
  fs.writeFileSync(TRACE_JSON_OUTPUT, JSON.stringify(reportPayload, null, 2), 'utf8');
  fs.writeFileSync(
    TRACE_REPORT_OUTPUT,
    buildTraceReportHtml({
      generatedAt: reportPayload.generatedAt,
      baseUrl: BASE_URL,
      room,
      scorecardComponentId: SCORECARD_COMPONENT_ID,
      widgetComponentId: WIDGET_COMPONENT_ID,
      runResponses: {
        scorecard: runResponse,
        canvas: canvasRunResponse,
      },
      scorecardTask,
      taskValidations: {
        scorecard: scorecardTaskValidation,
        canvas: canvasTaskValidation,
      },
      sync: {
        confirmed: syncConfirmed,
        rowCount: syncedRowCount,
      },
      traceTaskSource,
      task,
      traceId,
      events: traceEvents,
    }),
    'utf8',
  );

  process.stdout.write(
    [
      `Video: ${VIDEO_OUTPUT}`,
      `Trace report: ${TRACE_REPORT_OUTPUT}`,
      `Trace json: ${TRACE_JSON_OUTPUT}`,
      `Task: ${task?.id ?? 'none'}`,
      `Trace: ${traceId ?? 'none'}`,
    ].join('\n') + '\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type FrameLocator, type Page } from '@playwright/test';
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
const SCREENSHOT_OUTPUT = path.join(PROOF_DIR, 'timeline-widget-proof.png');
const TIMELINE_COMPONENT_ID = 'mcp-timeline-widget-proof';
const TIMELINE_TITLE = 'Launch Timeline';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });
const logStep = (message: string) => process.stdout.write(`[timeline-proof] ${message}\n`);

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

type TimelineProofSync = {
  confirmed: boolean;
  laneCount: number;
  itemCount: number;
  dependencyCount: number;
  syncChipText: string;
  exportChipText: string;
  detailExpanded: boolean;
};

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

async function waitForCanvasRoom(page: Page): Promise<{ canvasId: string | null; room: string }> {
  await page.waitForFunction(() => {
    const roomName =
      (window as any).__present?.syncContract?.livekitRoomName ||
      (window as any).__present?.livekitRoomName;
    if (typeof roomName === 'string' && roomName.trim().length > 0) {
      return true;
    }
    const id = new URL(window.location.href).searchParams.get('id');
    return typeof id === 'string' && id.trim().length > 0;
  });
  return await page.evaluate(() => {
    const canvasId = new URL(window.location.href).searchParams.get('id');
    const roomName =
      (window as any).__present?.syncContract?.livekitRoomName ||
      (window as any).__present?.livekitRoomName;
    if (typeof roomName === 'string' && roomName.trim().length > 0) {
      return {
        canvasId: typeof canvasId === 'string' && canvasId.trim().length > 0 ? canvasId : null,
        room: roomName.trim(),
      };
    }
    if (typeof canvasId === 'string' && canvasId.trim().length > 0) {
      return { canvasId, room: `canvas-${canvasId}` };
    }
    throw new Error('Canvas room was not resolved');
  });
}

async function waitForCanvasComponentShape(page: Page, componentId: string, timeoutMs = 60_000) {
  await page.waitForFunction(
    (targetComponentId) => {
      const editor = (window as any).__tldrawEditor;
      const shapes = editor?.getCurrentPageShapes?.() ?? [];
      return shapes.some(
        (shape: any) =>
          shape?.type === 'custom' &&
          String(shape?.props?.customComponent || '') === targetComponentId,
      );
    },
    componentId,
    { timeout: timeoutMs },
  );
}

async function placeTimelineWidgetOnCanvas(page: Page, componentId: string) {
  await page.evaluate(
    (targetComponentId) => {
      const editor = (window as any).__tldrawEditor;
      const shapes = editor?.getCurrentPageShapes?.() ?? [];
      const widget = shapes.find(
        (shape: any) =>
          shape?.type === 'custom' &&
          String(shape?.props?.customComponent || '') === targetComponentId,
      );
      if (!widget) return;
      editor.updateShapes([
        {
          id: widget.id,
          type: 'custom',
          x: 80,
          y: 120,
        },
      ]);
    },
    componentId,
  );
}

async function assertWidgetVisibleInViewport(page: Page, selector: string) {
  const locator = page.locator(selector);
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Timeline widget iframe does not have a visible bounding box');
  }
  if (box.width < 200 || box.height < 160) {
    throw new Error(`Timeline widget iframe bounding box is too small (${box.width}x${box.height})`);
  }
}

async function dispatchTimelineRun(
  page: Page,
  room: string,
  componentId: string,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ room, componentId }) => {
      const now = Date.now();
      const requestId = `timeline-proof-${now}`;
      const traceId = `timeline-proof-trace-${now}`;
      const intentId = `timeline-proof-intent-${now}`;
      const response = await fetch('/api/steward/runTimeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          componentId,
          task: 'timeline.patch',
          source: 'tool',
          runtimeScope: 'local',
          requestId,
          traceId,
          intentId,
          summary: 'Seed deterministic timeline proof snapshot.',
          ops: [
            {
              type: 'set_meta',
              title: 'Platform Launch Timeline',
              subtitle: 'Multi-team roadmap for live planning, sprint flow, and blockers.',
              horizonLabel: 'Q2 launch sprint window',
            },
            {
              type: 'upsert_lane',
              lane: { id: 'lane-product', name: 'Product', kind: 'team', order: 0, color: '#7bb7ff' },
            },
            {
              type: 'upsert_lane',
              lane: { id: 'lane-engineering', name: 'Engineering', kind: 'team', order: 1, color: '#74c69d' },
            },
            {
              type: 'upsert_lane',
              lane: { id: 'lane-go-to-market', name: 'Go To Market', kind: 'team', order: 2, color: '#e9b25f' },
            },
            {
              type: 'upsert_item',
              item: {
                id: 'item-brief',
                laneId: 'lane-product',
                title: 'Finalize launch brief',
                type: 'milestone',
                status: 'in_progress',
                owner: 'Product',
                summary: 'Lock positioning, feature set, and launch narrative with design and GTM.',
                notes: 'Needs final approval before kickoff packets go out.',
                sprintLabel: 'Sprint 14',
                dueLabel: 'Apr 8',
                tags: ['brief', 'launch'],
                blockedBy: [],
                createdAt: now,
                updatedAt: now,
              },
            },
            {
              type: 'upsert_item',
              item: {
                id: 'item-realtime',
                laneId: 'lane-engineering',
                title: 'Ship realtime webhook ingest',
                type: 'task',
                status: 'at_risk',
                owner: 'Platform',
                summary: 'Normalize webhook, form, and tool updates into canonical timeline ops.',
                notes: 'At risk until retry semantics are proven under rapid updates.',
                sprintLabel: 'Sprint 14',
                dueLabel: 'Apr 10',
                tags: ['realtime', 'ingest'],
                blockedBy: ['item-brief'],
                createdAt: now,
                updatedAt: now,
              },
            },
            {
              type: 'upsert_item',
              item: {
                id: 'item-sales-kit',
                laneId: 'lane-go-to-market',
                title: 'Prep sales enablement kit',
                type: 'handoff',
                status: 'planned',
                owner: 'GTM',
                summary: 'Build launch talk track, FAQ, and internal demo reel.',
                notes: 'Starts once the launch brief is locked.',
                startLabel: 'Apr 9',
                dueLabel: 'Apr 15',
                tags: ['enablement'],
                blockedBy: ['item-brief'],
                createdAt: now,
                updatedAt: now,
              },
            },
            {
              type: 'upsert_item',
              item: {
                id: 'item-auth-blocker',
                laneId: 'lane-engineering',
                title: 'Resolve auth callback blocker',
                type: 'blocker',
                status: 'blocked',
                owner: 'Infra',
                summary: 'Local callback mismatch is blocking stable staging verification.',
                notes: 'Needs environment parity before the launch walkthrough can rehearse cleanly.',
                sprintLabel: 'Sprint 14',
                tags: ['blocker', 'auth'],
                blockedBy: [],
                createdAt: now,
                updatedAt: now,
              },
            },
            {
              type: 'set_dependency',
              dependency: {
                id: 'dep-brief-realtime',
                fromItemId: 'item-brief',
                toItemId: 'item-realtime',
                kind: 'depends_on',
                label: 'Schema and scope locked',
              },
            },
            {
              type: 'stage_export',
              exportStage: {
                id: 'export-linear',
                target: 'linear',
                status: 'queued',
                summary: 'Linear export staged for roadmap review.',
                queuedAt: now,
                updatedAt: now,
              },
            },
          ],
        }),
      });
      let payload = {};
      try {
        payload = await response.json();
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
      `${label} dispatch did not enqueue a task (ok=${String(runResponse.ok)}, status=${String(
        runResponse.status,
      )}, taskId=${String(taskId)})`,
    );
  }
  return taskId;
}

function requireSucceededTask(label: string, task: TaskRow | null): TaskValidation {
  if (!task || task.status !== 'succeeded') {
    throw new Error(
      `${label} task did not succeed (status=${task?.status ?? 'missing'}, id=${task?.id ?? 'missing'})`,
    );
  }
  const errorText = typeof task.error === 'string' ? task.error.trim() : '';
  if (!errorText) {
    return { status: 'ok' };
  }
  return {
    status: 'warning',
    message: `${label} task succeeded with non-fatal warning: ${errorText}`,
  };
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
      if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
        return task;
      }
    }
    await sleep(1200);
  }
  throw new Error(`Timed out waiting for task completion: ${taskId}`);
}

async function resolveTraceId(supabase: SupabaseClient, task: TaskRow): Promise<string | null> {
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

async function loadTraceEvents(supabase: SupabaseClient, traceId: string): Promise<TraceEventRow[]> {
  const { data, error } = await supabase
    .from('agent_trace_events')
    .select('id,trace_id,task_id,task,stage,status,latency_ms,created_at,payload')
    .eq('trace_id', traceId)
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) {
    throw new Error(`Failed reading trace events for ${traceId}: ${error.message}`);
  }
  return (data || []) as TraceEventRow[];
}

async function loadTaskScopedEvents(supabase: SupabaseClient, taskId: string): Promise<TraceEventRow[]> {
  const { data, error } = await supabase
    .from('agent_trace_events')
    .select('id,trace_id,task_id,task,stage,status,latency_ms,created_at,payload')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) {
    throw new Error(`Failed reading task-scoped events for ${taskId}: ${error.message}`);
  }
  return (data || []) as TraceEventRow[];
}

async function waitForTimelineRender(frameLocator: FrameLocator): Promise<TimelineProofSync> {
  const start = Date.now();
  let detailExpanded = false;
  const expectedExportChip = 'export linear queued';

  while (Date.now() - start < 60_000) {
    const titleText = ((await frameLocator.locator('[data-testid="timeline-title"]').textContent()) || '').trim();
    const laneCount = await frameLocator.locator('[data-testid="timeline-lane"]').count();
    const itemCount = await frameLocator.locator('[data-testid="timeline-item"]').count();
    const dependencyCount = await frameLocator.locator('[data-testid="timeline-dependency"]').count();
    const syncChipText = ((await frameLocator.locator('[data-testid="timeline-sync-chip"]').textContent()) || '').trim();
    const exportChipText = ((await frameLocator.locator('[data-testid="timeline-export-chip"]').textContent()) || '').trim();
    const bodyText = (((await frameLocator.locator('body').textContent()) || '').toLowerCase());

    const noLegacyCopy =
      !bodyText.includes('scorecard') &&
      !bodyText.includes('debate') &&
      !bodyText.includes('waiting for scorecard sync');
    const ready =
      titleText !== 'Waiting for timeline sync' &&
      laneCount >= 2 &&
      itemCount >= 3 &&
      dependencyCount >= 1 &&
      syncChipText.length > 0 &&
      exportChipText.toLowerCase() === expectedExportChip &&
      noLegacyCopy;

    if (ready) {
      const firstCard = frameLocator.locator('[data-testid="timeline-item"]').first();
      if ((await firstCard.count()) > 0) {
        await firstCard.locator('[data-testid="timeline-detail-toggle"]').click();
        await firstCard.locator('[data-testid="timeline-detail"]').waitFor({ state: 'visible', timeout: 5000 });
        detailExpanded = true;
      }
      return {
        confirmed: true,
        laneCount,
        itemCount,
        dependencyCount,
        syncChipText,
        exportChipText,
        detailExpanded,
      };
    }
    await sleep(1000);
  }

  throw new Error('Timeline widget did not render the roadmap proof state within timeout.');
}

function buildTraceReportHtml(args: {
  generatedAt: string;
  baseUrl: string;
  room: string;
  timelineComponentId: string;
  timelineRunResponse: Record<string, unknown>;
  timelineTask: TaskRow;
  timelineValidation: TaskValidation;
  sync: TimelineProofSync;
  traceTaskSource: 'timeline';
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
        <div class="label">Timeline Component</div><div>${escapeHtml(args.timelineComponentId)}</div>
        <div class="label">Trace Source</div><div>${escapeHtml(args.traceTaskSource)}</div>
        <div class="label">Timeline Task</div><div>${escapeHtml(args.timelineTask.id)} (${escapeHtml(args.timelineTask.status ?? '--')})</div>
        <div class="label">Timeline Validation</div><div>${escapeHtml(args.timelineValidation.status)}${args.timelineValidation.message ? ` · ${escapeHtml(args.timelineValidation.message)}` : ''}</div>
        <div class="label">Trace ID</div><div>${escapeHtml(args.traceId ?? '--')}</div>
        <div class="label">Trace Events</div><div>${args.events.length}</div>
        <div class="label">Sync Confirmed</div><div>${args.sync.confirmed ? 'yes' : 'no'}</div>
        <div class="label">Lane Count</div><div>${args.sync.laneCount}</div>
        <div class="label">Item Count</div><div>${args.sync.itemCount}</div>
        <div class="label">Dependency Count</div><div>${args.sync.dependencyCount}</div>
        <div class="label">Sync Chip</div><div>${escapeHtml(args.sync.syncChipText)}</div>
        <div class="label">Export Chip</div><div>${escapeHtml(args.sync.exportChipText)}</div>
        <div class="label">Detail Expanded</div><div>${args.sync.detailExpanded ? 'yes' : 'no'}</div>
      </div>
    </section>
    <section class="card">
      <h2>runTimeline Response</h2>
      <pre>${escapeHtml(JSON.stringify(args.timelineRunResponse, null, 2))}</pre>
    </section>
    <section class="card">
      <h2>Timeline Task Row</h2>
      <pre>${escapeHtml(JSON.stringify(args.timelineTask, null, 2))}</pre>
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
  logStep(`starting capture against ${BASE_URL}`);

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
  await page.waitForFunction(() => Boolean((window as any).__tldrawEditor), null, {
    timeout: 120_000,
  });

  const { room } = await waitForCanvasRoom(page);
  logStep(`canvas room resolved: ${room}`);

  await executeToolCall(page, 'create_component', {
    type: 'McpAppWidget',
    messageId: TIMELINE_COMPONENT_ID,
    spec: {
      title: TIMELINE_TITLE,
      resourceUri: '/mcp-apps/timeline.html',
      syncSource: 'timeline',
      syncRoom: room,
      syncComponentId: TIMELINE_COMPONENT_ID,
      syncIntervalMs: 1200,
      autoRun: false,
      displayMode: 'inline',
    },
  });

  await waitForCanvasComponentShape(page, TIMELINE_COMPONENT_ID, 120_000);
  await placeTimelineWidgetOnCanvas(page, TIMELINE_COMPONENT_ID);
  await page.waitForSelector(`iframe[title="${TIMELINE_TITLE}"]`, {
    state: 'visible',
    timeout: 120_000,
  });
  await assertWidgetVisibleInViewport(page, `iframe[title="${TIMELINE_TITLE}"]`);
  logStep('timeline widget iframe mounted');

  const frameLocator = page.frameLocator(`iframe[title="${TIMELINE_TITLE}"]`);
  await frameLocator.locator('[data-testid="timeline-title"]').waitFor({ state: 'visible', timeout: 60_000 });

  logStep('dispatching timeline patch task');
  const timelineRunResponse = await dispatchTimelineRun(page, room, TIMELINE_COMPONENT_ID);
  const timelineTaskId = requireQueuedRun('runTimeline', timelineRunResponse);
  const timelineTask = await waitForTaskCompletion(supabase, timelineTaskId);
  const timelineValidation = requireSucceededTask('runTimeline', timelineTask);
  logStep(`timeline task completed: ${timelineTask.id}`);

  let traceId = await resolveTraceId(supabase, timelineTask);
  let traceEvents: TraceEventRow[] = [];
  if (traceId) {
    traceEvents = await loadTraceEvents(supabase, traceId);
  } else {
    traceEvents = await loadTaskScopedEvents(supabase, timelineTask.id);
    if (traceEvents.length > 0) {
      traceId = `task:${timelineTask.id}`;
    }
  }
  if (!traceId || traceEvents.length === 0) {
    throw new Error(
      `Trace evidence missing for timeline task ${timelineTask.id} (traceId=${String(traceId)}, events=${traceEvents.length})`,
    );
  }

  const sync = await waitForTimelineRender(frameLocator);
  logStep('timeline widget rendered proof state');
  await page.screenshot({ path: SCREENSHOT_OUTPUT, fullPage: false });
  await page.waitForTimeout(2500);

  const video = page.video();
  await context.close();
  await browser.close();
  const videoPath = video ? await video.path() : null;

  if (!videoPath) {
    throw new Error('Playwright did not produce a video path');
  }

  fs.copyFileSync(videoPath, VIDEO_OUTPUT);
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });

  const reportPayload = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    room,
    timelineComponentId: TIMELINE_COMPONENT_ID,
    timelineRunResponse,
    timelineTask,
    timelineValidation,
    syncConfirmed: sync.confirmed,
    syncedLaneCount: sync.laneCount,
    syncedItemCount: sync.itemCount,
    syncedDependencyCount: sync.dependencyCount,
    syncChipText: sync.syncChipText,
    exportChipText: sync.exportChipText,
    detailExpanded: sync.detailExpanded,
    traceTaskSource: 'timeline' as const,
    traceId,
    traceEvents,
    screenshot: SCREENSHOT_OUTPUT,
    video: VIDEO_OUTPUT,
  };
  fs.writeFileSync(TRACE_JSON_OUTPUT, JSON.stringify(reportPayload, null, 2), 'utf8');
  fs.writeFileSync(
    TRACE_REPORT_OUTPUT,
    buildTraceReportHtml({
      generatedAt: reportPayload.generatedAt,
      baseUrl: BASE_URL,
      room,
      timelineComponentId: TIMELINE_COMPONENT_ID,
      timelineRunResponse,
      timelineTask,
      timelineValidation,
      sync,
      traceTaskSource: 'timeline',
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
      `Screenshot: ${SCREENSHOT_OUTPUT}`,
      `Task: ${timelineTask.id}`,
      `Trace: ${traceId}`,
    ].join('\n') + '\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const now = () => new Date().toISOString();

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    prompt: 'Draw a small rectangle labeled trace-smoke.',
    displayName: process.env.PLAYWRIGHT_DISPLAY_NAME || 'Codex Smoke',
    outDir: path.join(process.cwd(), 'test-results', 'observability-smoke'),
    timeoutMs: 45_000,
    headless: true,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value) continue;
    if (value === '--headed') {
      args.headless = false;
      continue;
    }
    if (value.startsWith('--baseUrl=')) args.baseUrl = value.split('=').slice(1).join('=');
    else if (value.startsWith('--prompt=')) args.prompt = value.split('=').slice(1).join('=');
    else if (value.startsWith('--displayName=')) args.displayName = value.split('=').slice(1).join('=');
    else if (value.startsWith('--outDir=')) args.outDir = value.split('=').slice(1).join('=');
    else if (value.startsWith('--timeoutMs=')) args.timeoutMs = Number(value.split('=').slice(1).join('')) || args.timeoutMs;
  }
  return args;
}

async function passJoinGate(page, { timeoutMs, displayName }) {
  const visible = await page
    .waitForFunction(() => document.body.textContent?.toLowerCase().includes('join the demo'), null, { timeout: 3500 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;
  const input = page
    .locator('input[placeholder*="Alex"], input[name="displayName"], input[id*="display"], form input, input')
    .first();
  await input.fill(displayName);
  const joinButton = page
    .locator('button:has-text("Join"), button[type="submit"], [role="button"]:has-text("Join")')
    .first();
  await joinButton.click();
  await page
    .waitForFunction(
      () => !document.body.textContent?.toLowerCase().includes('join the demo'),
      null,
      { timeout: timeoutMs },
    )
    .catch(() => {});
  return true;
}

async function waitForCanvas(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page
      .evaluate(() => {
        const editor = window.__present?.tldrawEditor || window.__PRESENT__?.tldraw;
        if (editor) return true;
        return Boolean(
          document.querySelector('[data-canvas-space="true"]') ||
            document.querySelector('.tl-canvas') ||
            document.querySelector('.tl-container'),
        );
      })
      .catch(() => false);
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

async function pollTaskStatus(request, { taskId, room, timeoutMs }) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    const response = await request.get(`/api/steward/task-status?taskId=${encodeURIComponent(taskId)}&room=${encodeURIComponent(room)}`);
    const body = await response.json().catch(() => null);
    if (response.ok && body?.task?.status) {
      const status = String(body.task.status).toLowerCase();
      if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
        return {
          terminal: true,
          attempt,
          status,
          body,
        };
      }
      return {
        terminal: false,
        attempt,
        status,
        body,
      };
    }
    if (response.status() === 401 || response.status() === 403 || response.status() === 404) {
      return {
        terminal: true,
        attempt,
        status: `http_${response.status()}`,
        body,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 250 + attempt * 100)));
  }
  return {
    terminal: true,
    attempt: -1,
    status: 'timeout',
    body: null,
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const runId = `smoke-${Date.now()}`;
  const canvasId = `obs-${Date.now()}`;
  const room = `canvas-${canvasId}`;
  const outputDir = path.join(args.outDir, runId);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({ baseURL: args.baseUrl, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const result = {
    runId,
    startedAt: now(),
    baseUrl: args.baseUrl,
    room,
    canvasId,
    prompt: args.prompt,
    displayName: args.displayName,
    request: null,
    taskStatus: null,
    sessionCorrelation: null,
    notes: [],
    screenshot: null,
    error: null,
    endedAt: null,
  };

  try {
    await page.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, { waitUntil: 'domcontentloaded' });
    const joined = await passJoinGate(page, { timeoutMs: args.timeoutMs, displayName: args.displayName });
    if (joined) {
      result.notes.push('Join gate detected and completed before canvas readiness check.');
    }
    const canvasReady = await waitForCanvas(page, args.timeoutMs);
    if (!canvasReady) {
      result.notes.push('Canvas did not report ready within timeout; continuing with API-side correlation checks.');
    }

    const roomName = await page.evaluate(() => {
      const direct = window.__present?.livekitRoomName || window.__present_roomName || window.__present_canvas_room;
      if (typeof direct === 'string' && direct.trim()) return direct.trim();
      const url = new URL(window.location.href);
      const id = url.searchParams.get('id');
      return id ? `canvas-${id}` : '';
    });
    if (typeof roomName === 'string' && roomName.trim()) {
      result.room = roomName.trim();
    }

    const runCanvasResponse = await page.request.post('/api/steward/runCanvas', {
      data: {
        room: result.room,
        task: 'fairy.intent',
        params: {
          message: args.prompt,
          contextProfile: 'standard',
        },
        summary: args.prompt,
      },
    });
    const runCanvasBody = await runCanvasResponse.json().catch(() => null);
    result.request = {
      status: runCanvasResponse.status(),
      ok: runCanvasResponse.ok(),
      body: runCanvasBody,
    };

    const taskId = typeof runCanvasBody?.taskId === 'string' ? runCanvasBody.taskId : null;
    if (taskId) {
      result.taskStatus = await pollTaskStatus(page.request, {
        taskId,
        room: result.room,
        timeoutMs: args.timeoutMs,
      });
    } else {
      result.notes.push('runCanvas did not return taskId; unable to poll /api/steward/task-status');
    }

    const sessionResponse = await page.request.get(
      `/api/admin/agents/session?room=${encodeURIComponent(result.room)}&limit=200`,
    );
    const sessionBody = await sessionResponse.json().catch(() => null);
    result.sessionCorrelation = {
      status: sessionResponse.status(),
      ok: sessionResponse.ok(),
      body: sessionBody,
    };
    if (!sessionResponse.ok()) {
      result.notes.push(
        'Admin session correlation endpoint not accessible in current browser auth context. ' +
          'Sign in with allowlisted user or set AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS=true temporarily.',
      );
    }

    const screenshotPath = path.join(outputDir, 'canvas.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot = screenshotPath;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.notes.push('Run failed before full correlation completed.');
    const screenshotPath = path.join(outputDir, 'canvas-failure.png');
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshot = screenshotPath;
    } catch {
      result.notes.push('Failure screenshot capture did not complete.');
    }
  } finally {
    result.endedAt = now();
    await fs.writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    await context.close();
    await browser.close();
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(
    `[playwright-smoke-and-correlate] failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exit(1);
});

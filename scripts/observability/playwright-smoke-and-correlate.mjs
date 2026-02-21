#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

const now = () => new Date().toISOString();
const readString = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
['.env.local', '.env.development.local', '.env'].forEach((candidate) => {
  loadDotenv({ path: path.join(process.cwd(), candidate), override: false });
});

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    prompt: 'Use the fast Cerebras fairy path and ensure one sticky note with id smoke-sticky at x=0 y=0 and exact text TRACE_SMOKE.',
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

async function ensureSeededAuthUser(credentials) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return { seeded: false, reason: 'missing_env' };

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await adminClient.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: { full_name: credentials.name },
  });

  if (error && !/already been registered|already exists/i.test(error.message || '')) {
    return { seeded: false, reason: error.message || 'unknown_error' };
  }
  if (error) {
    const targetEmail = credentials.email.trim().toLowerCase();
    let page = 1;
    let userId = null;
    while (!userId && page <= 10) {
      const { data: listedUsers, error: listError } = await adminClient.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError) {
        return { seeded: false, reason: listError.message || 'list_users_failed' };
      }
      const users = Array.isArray(listedUsers?.users) ? listedUsers.users : [];
      const matchedUser = users.find((user) => (user.email || '').trim().toLowerCase() === targetEmail);
      if (matchedUser?.id) {
        userId = matchedUser.id;
        break;
      }
      if (users.length < 200) break;
      page += 1;
    }
    if (userId) {
      const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
        password: credentials.password,
        email_confirm: true,
        user_metadata: { full_name: credentials.name },
      });
      if (updateError) {
        return { seeded: false, reason: updateError.message || 'update_user_failed' };
      }
    } else {
      return { seeded: false, reason: 'existing_user_not_found_for_password_reset' };
    }
  }
  return { seeded: true, reason: null };
}

async function signInWithEmail(page, options = {}) {
  const email = options.email || process.env.PLAYWRIGHT_EMAIL;
  const password = options.password || process.env.PLAYWRIGHT_PASSWORD;
  const name = options.name || process.env.PLAYWRIGHT_NAME || 'Codex Smoke';
  if (!email || !password) {
    return { mode: 'signin', email: email ?? null, ok: false, error: 'Missing email/password' };
  }
  await page.goto('/auth/signin', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(600);
  const emailField = page.locator('#email').first();
  const passwordField = page.locator('#password').first();
  const signInButton = page.locator('button[type="submit"]').first();

  const formVisible = await Promise.all([
    emailField.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false),
    signInButton.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false),
  ]).then((values) => values.every(Boolean));

  if (formVisible) {
    await emailField.fill(email);
    await passwordField.fill(password);
    await signInButton.click();
    const signedIn = await page
      .waitForURL(/\/canvas/i, { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    if (signedIn) {
      await page.waitForTimeout(800);
      return { mode: 'signin', email, name, ok: true };
    }
  }

  const signInErrorText = await page
    .locator('text=Invalid email or password, text=Something went wrong, text=error')
    .first()
    .textContent()
    .catch(() => null);

  return { mode: 'signin', email, name, ok: false, error: signInErrorText || 'Sign-in did not reach /canvas' };
}

async function passJoinGate(page, { timeoutMs, displayName }) {
  const visible = await page
    .waitForFunction(() => document.body.textContent?.toLowerCase().includes('join the demo'), null, { timeout: 3500 })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    return page
      .evaluate(() => {
        const text = (document.body.textContent || '').toLowerCase();
        return !text.includes('join the demo');
      })
      .catch(() => false);
  }
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

const countBy = (values) =>
  values.reduce((acc, value) => {
    const key = typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const readTaskTraceId = (task) =>
  readString(task?.trace_id) || readString(task?.resolved_trace_id) || readString(task?.traceId) || null;

async function fetchSessionCorrelationViaSupabase(room, limit = 200) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const queueSelectWithTrace =
    'id,room,task,status,priority,attempt,error,request_id,trace_id,resource_keys,lease_expires_at,created_at,updated_at,result';
  const queueSelectCompat =
    'id,room,task,status,priority,attempt,error,request_id,resource_keys,lease_expires_at,created_at,updated_at,result';

  const queueWithTrace = await db
    .from('agent_tasks')
    .select(queueSelectWithTrace)
    .eq('room', room)
    .order('created_at', { ascending: false })
    .limit(limit);

  let tasks = [];
  if (
    queueWithTrace.error &&
    /trace_id/i.test(
      `${queueWithTrace.error.message || ''} ${queueWithTrace.error.details || ''} ${queueWithTrace.error.hint || ''}`,
    ) &&
    /column|schema cache|does not exist/i.test(
      `${queueWithTrace.error.message || ''} ${queueWithTrace.error.details || ''} ${queueWithTrace.error.hint || ''}`,
    )
  ) {
    const queueCompat = await db
      .from('agent_tasks')
      .select(queueSelectCompat)
      .eq('room', room)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (queueCompat.error) throw queueCompat.error;
    tasks = (queueCompat.data ?? []).map((row) => ({ ...row, trace_id: null }));
  } else if (queueWithTrace.error) {
    throw queueWithTrace.error;
  } else {
    tasks = queueWithTrace.data ?? [];
  }

  const tracesQuery = await db
    .from('agent_trace_events')
    .select('*')
    .eq('room', room)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (tracesQuery.error) throw tracesQuery.error;
  const traces = tracesQuery.data ?? [];

  const traceIdsByRequest = new Map();
  const traceIdsByTask = new Map();
  for (const trace of traces) {
    const traceId = readString(trace.trace_id);
    if (!traceId) continue;
    const requestId = readString(trace.request_id);
    const taskId = readString(trace.task_id);
    if (requestId && !traceIdsByRequest.has(requestId)) traceIdsByRequest.set(requestId, traceId);
    if (taskId && !traceIdsByTask.has(taskId)) traceIdsByTask.set(taskId, traceId);
  }
  tasks = tasks.map((task) => {
    const direct = readString(task.trace_id);
    const resolved =
      direct ||
      (readString(task.id) ? traceIdsByTask.get(readString(task.id)) ?? null : null) ||
      (readString(task.request_id) ? traceIdsByRequest.get(readString(task.request_id)) ?? null : null);
    return {
      ...task,
      resolved_trace_id: resolved,
      trace_integrity: direct ? 'direct' : resolved ? 'resolved_from_events' : 'missing',
    };
  });

  const traceIds = new Set();
  const requestIds = new Set();
  for (const task of tasks) {
    const traceId = readTaskTraceId(task);
    const requestId = readString(task.request_id);
    if (traceId) traceIds.add(traceId);
    if (requestId) requestIds.add(requestId);
  }
  for (const trace of traces) {
    const traceId = readString(trace.trace_id);
    const requestId = readString(trace.request_id);
    if (traceId) traceIds.add(traceId);
    if (requestId) requestIds.add(requestId);
  }

  return {
    ok: true,
    actorUserId: 'service-role',
    room,
    limit,
    summary: {
      tasksTotal: tasks.length,
      tracesTotal: traces.length,
      uniqueTraceIds: traceIds.size,
      uniqueRequestIds: requestIds.size,
      taskStatusCounts: countBy(tasks.map((task) => task.status)),
      traceStageCounts: countBy(traces.map((trace) => trace.stage)),
      missingTraceOnTasks: tasks.filter((task) => !readTaskTraceId(task)).length,
    },
    tasks,
    traces,
  };
}

async function pollTaskStatusViaSupabase({ room, taskId, timeoutMs }) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const session = await fetchSessionCorrelationViaSupabase(room, 200).catch(() => null);
    const tasks = Array.isArray(session?.tasks) ? session.tasks : [];
    const task = tasks.find((entry) => readString(entry?.id) === taskId) ?? null;
    const status = readString(task?.status)?.toLowerCase() ?? null;
    if (status && ['succeeded', 'failed', 'canceled'].includes(status)) {
      return {
        terminal: true,
        attempt,
        status,
        source: 'supabase',
        body: { task },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 250 + attempt * 90)));
  }
  return {
    terminal: true,
    attempt: -1,
    status: 'timeout',
    source: 'supabase',
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
    joined: false,
    request: null,
    taskStatus: null,
    taskStatusFallback: null,
    sessionCorrelation: null,
    proof: null,
    notes: [],
    screenshot: null,
    error: null,
    authSeed: null,
    auth: null,
    endedAt: null,
  };

  try {
    const providedEmail = process.env.PLAYWRIGHT_EMAIL;
    const providedPassword = process.env.PLAYWRIGHT_PASSWORD;
    if (providedEmail && providedPassword) {
      const authSeed = {
        email: providedEmail,
        password: providedPassword,
        name: process.env.PLAYWRIGHT_NAME || args.displayName,
      };
      const seededUser = await ensureSeededAuthUser(authSeed);
      result.authSeed = seededUser;
      const authResult = await signInWithEmail(page, authSeed);
      result.auth = authResult;
      if (!authResult?.ok) {
        result.notes.push(`Optional sign-in failed: ${authResult?.error || 'unknown'}. Continuing with fallback correlation.`);
      }
    } else {
      result.notes.push('No PLAYWRIGHT_EMAIL/PASSWORD provided; using service-role correlation fallback.');
    }

    await page.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, { waitUntil: 'domcontentloaded' });
    result.joined = await passJoinGate(page, { timeoutMs: args.timeoutMs, displayName: args.displayName });
    if (result.joined) {
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
    if (!runCanvasResponse.ok()) {
      throw new Error(`runCanvas request failed with status ${runCanvasResponse.status()}`);
    }
    if (!taskId) {
      throw new Error('runCanvas did not return taskId; cannot prove queue-to-worker execution.');
    }

    result.taskStatus = await pollTaskStatus(page.request, {
      taskId,
      room: result.room,
      timeoutMs: args.timeoutMs,
    });
    const polledStatus = readString(result.taskStatus?.status)?.toLowerCase() ?? null;
    if (polledStatus === 'http_401' || polledStatus === 'http_403' || polledStatus === 'http_404') {
      result.taskStatusFallback = await pollTaskStatusViaSupabase({
        room: result.room,
        taskId,
        timeoutMs: args.timeoutMs,
      });
    }

    const sessionResponse = await page.request.get(
      `/api/admin/agents/session?room=${encodeURIComponent(result.room)}&limit=200`,
    );
    let sessionBody = await sessionResponse.json().catch(() => null);
    if (sessionResponse.ok()) {
      result.sessionCorrelation = {
        status: sessionResponse.status(),
        ok: sessionResponse.ok(),
        source: 'api',
        body: sessionBody,
      };
    } else {
      const supabaseFallback = await fetchSessionCorrelationViaSupabase(result.room, 200).catch(() => null);
      if (supabaseFallback?.ok) {
        sessionBody = supabaseFallback;
        result.sessionCorrelation = {
          status: 200,
          ok: true,
          source: 'supabase',
          body: sessionBody,
        };
      } else {
        result.sessionCorrelation = {
          status: sessionResponse.status(),
          ok: sessionResponse.ok(),
          source: 'api',
          body: sessionBody,
        };
        throw new Error(
          'Admin session correlation endpoint was not accessible for this smoke run. ' +
            'Enable AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS or use an allowlisted user.',
        );
      }
    }
    const sessionTasks = Array.isArray(sessionBody?.tasks) ? sessionBody.tasks : [];
    const sessionTaskRecord = sessionTasks.find((entry) => readString(entry?.id) === taskId) ?? null;

    let finalTaskStatus = readString(result.taskStatus?.status);
    const fallbackStatus = readString(result.taskStatusFallback?.status);
    if (fallbackStatus && ['succeeded', 'failed', 'canceled'].includes(fallbackStatus.toLowerCase())) {
      finalTaskStatus = fallbackStatus.toLowerCase();
    }
    if (
      finalTaskStatus &&
      ['http_401', 'http_403'].includes(finalTaskStatus) &&
      sessionTaskRecord &&
      readString(sessionTaskRecord.status)
    ) {
      finalTaskStatus = String(sessionTaskRecord.status).toLowerCase();
      result.notes.push(
        `task-status endpoint ${result.taskStatus.status}; resolved terminal state from admin session endpoint.`,
      );
    }

    if (finalTaskStatus !== 'succeeded') {
      throw new Error(`task ${taskId} did not succeed (status=${finalTaskStatus ?? 'unknown'})`);
    }
    if (!result.joined) {
      throw new Error('Join gate could not be confirmed for this smoke run.');
    }

    const taskRecord = (result.taskStatus?.body?.task && typeof result.taskStatus.body.task === 'object')
      ? result.taskStatus.body.task
      : result.taskStatusFallback?.body?.task && typeof result.taskStatusFallback.body.task === 'object'
        ? result.taskStatusFallback.body.task
        : sessionTaskRecord;
    const taskTraceId =
      readString(taskRecord?.trace_id) ??
      readString(taskRecord?.resolved_trace_id) ??
      readString(taskRecord?.traceId);
    const taskRequestId = readString(taskRecord?.request_id) ?? readString(taskRecord?.requestId);
    const requestTraceId = readString(runCanvasBody?.traceId);
    const requestRequestId = readString(runCanvasBody?.requestId);

    const summary = sessionBody?.summary && typeof sessionBody.summary === 'object' ? sessionBody.summary : {};
    const stageCounts =
      summary.traceStageCounts && typeof summary.traceStageCounts === 'object'
        ? summary.traceStageCounts
        : {};
    const actionsDispatchedCount =
      Number(stageCounts.actions_dispatched ?? 0) +
      Number(stageCounts.ack_received ?? 0);
    const missingTraceOnTasks = Number(summary.missingTraceOnTasks ?? 0);
    const taskResult =
      sessionTaskRecord?.result && typeof sessionTaskRecord.result === 'object' && !Array.isArray(sessionTaskRecord.result)
        ? sessionTaskRecord.result
        : null;
    const taskResultHasMutationEvidence = Boolean(
      readString(taskResult?.shapeId) ||
        (Array.isArray(taskResult?.shapeIds) && taskResult.shapeIds.length > 0) ||
        (typeof taskResult?.actionCount === 'number' && taskResult.actionCount > 0),
    );

    if ((!Number.isFinite(actionsDispatchedCount) || actionsDispatchedCount < 1) && !taskResultHasMutationEvidence) {
      throw new Error('Session correlation contains no dispatch or mutation evidence.');
    }
    if (Number.isFinite(missingTraceOnTasks) && missingTraceOnTasks > 0) {
      throw new Error(`Session correlation reported missingTraceOnTasks=${missingTraceOnTasks}.`);
    }

    const traceCandidates = new Set(
      [taskTraceId, requestTraceId].filter((value) => Boolean(value)),
    );
    const requestCandidates = new Set(
      [taskRequestId, requestRequestId, taskId].filter((value) => Boolean(value)),
    );
    const traces = Array.isArray(sessionBody?.traces) ? sessionBody.traces : [];
    const matchedDispatchTraces = traces.filter((trace) => {
      const stage = readString(trace?.stage)?.toLowerCase();
      if (stage !== 'actions_dispatched' && stage !== 'ack_received' && stage !== 'completed') return false;
      const traceId = readString(trace?.trace_id) ?? readString(trace?.traceId);
      const requestId = readString(trace?.request_id) ?? readString(trace?.requestId);
      return (
        (traceId && traceCandidates.has(traceId)) ||
        (requestId && requestCandidates.has(requestId))
      );
    });

    if (matchedDispatchTraces.length === 0 && !taskResultHasMutationEvidence) {
      throw new Error(
        `No dispatch/completed trace matched task ${taskId} ` +
          `(trace candidates=${Array.from(traceCandidates).join(',') || 'none'}, request candidates=${
            Array.from(requestCandidates).join(',') || 'none'
          }).`,
      );
    }

    result.proof = {
      taskId,
      taskStatus: finalTaskStatus,
      traceId: taskTraceId ?? requestTraceId,
      requestId: taskRequestId ?? requestRequestId ?? taskId,
      actionsDispatchedCount,
      matchedDispatchTraceCount: matchedDispatchTraces.length,
      taskResultHasMutationEvidence,
    };
    await fs.writeFile(path.join(outputDir, 'task-status.json'), JSON.stringify(result.taskStatus, null, 2), 'utf8');
    await fs.writeFile(
      path.join(outputDir, 'session-correlation.json'),
      JSON.stringify(result.sessionCorrelation, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(outputDir, 'dispatch-traces.json'),
      JSON.stringify(matchedDispatchTraces, null, 2),
      'utf8',
    );
    result.notes.push(
      `Proof linked: task=${taskId}, trace=${result.proof.traceId ?? 'n/a'}, actions_dispatched=${actionsDispatchedCount}`,
    );

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

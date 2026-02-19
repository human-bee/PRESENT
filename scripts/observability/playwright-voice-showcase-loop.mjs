#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

const nowIso = () => new Date().toISOString();
const readString = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
const describeError = (error) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};
['.env.local', '.env.development.local', '.env'].forEach((candidate) => {
  loadDotenv({ path: path.join(process.cwd(), candidate), override: false });
});

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    displayName: process.env.PLAYWRIGHT_DISPLAY_NAME || 'Codex Showcase',
    outDir: path.join(process.cwd(), 'test-results', 'observability-showcase'),
    timeoutMs: 90_000,
    headless: true,
    maxTurns: 12,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value) continue;
    if (value === '--headed') args.headless = false;
    else if (value.startsWith('--baseUrl=')) args.baseUrl = value.split('=').slice(1).join('=');
    else if (value.startsWith('--displayName=')) args.displayName = value.split('=').slice(1).join('=');
    else if (value.startsWith('--outDir=')) args.outDir = value.split('=').slice(1).join('=');
    else if (value.startsWith('--timeoutMs=')) args.timeoutMs = Number(value.split('=').slice(1).join('')) || args.timeoutMs;
    else if (value.startsWith('--maxTurns=')) args.maxTurns = Number(value.split('=').slice(1).join('')) || args.maxTurns;
  }
  return args;
}

function transcriptInput(page) {
  return page
    .locator(
      'input[placeholder*="Type a message for the agent"], input[placeholder*="Connecting to LiveKit"], input[placeholder*="message for the agent"]',
    )
    .first();
}

async function isTranscriptInteractive(page) {
  return page.evaluate(() => {
    const sendButtons = Array.from(document.querySelectorAll('button'));
    const send = sendButtons.find((button) => (button.textContent || '').trim() === 'Send');
    if (!send) return false;
    const rect = send.getBoundingClientRect();
    const inViewport =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight;
    return inViewport;
  });
}

async function ensureJoin(page, displayName) {
  const joinVisible = await page
    .waitForFunction(() => document.body.textContent?.toLowerCase().includes('join the demo'), null, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!joinVisible) return false;
  await page.locator('input').first().fill(displayName);
  await page.locator('button:has-text("Join")').first().click();
  await page.waitForTimeout(1200);
  return true;
}

async function signInWithEmail(page, options = {}) {
  const email = options.email || process.env.PLAYWRIGHT_EMAIL;
  const password = options.password || process.env.PLAYWRIGHT_PASSWORD;
  const name = options.name || process.env.PLAYWRIGHT_NAME || 'Codex Showcase';
  if (!email || !password) {
    return { mode: 'signin', email: email ?? null, ok: false, error: 'Missing email/password' };
  }
  // `networkidle` is brittle in dev because webpack/hot-reload asset requests can
  // keep the page "busy" while first compile warms up.
  await page.goto('/auth/signin', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(1000);
  const emailField = page.locator('#email').first();
  const passwordField = page.locator('#password').first();
  const signInButton = page.locator('button[type="submit"]').first();

  if ((await emailField.isVisible().catch(() => false)) && (await signInButton.isVisible().catch(() => false))) {
    await emailField.fill(email);
    await passwordField.fill(password);
    await signInButton.click();
    const signedIn = await page
      .waitForURL(/\/canvas/i, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (signedIn) return { mode: 'signin', email, ok: true };
  }

  const signInErrorText = await page
    .locator('text=Invalid email or password, text=Something went wrong, text=error')
    .first()
    .textContent()
    .catch(() => null);

  return { mode: 'signin', email, ok: false, error: signInErrorText || 'Sign-in did not reach /canvas' };
}

function buildAuthSeedCredentials() {
  const fallbackEmail = process.env.PLAYWRIGHT_SEED_EMAIL || 'showcase-fixed@present.local';
  const fallbackPassword = process.env.PLAYWRIGHT_SEED_PASSWORD || 'Devtools!FixedA1';
  return {
    email: fallbackEmail,
    password: fallbackPassword,
    name: 'Codex Showcase',
  };
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
    }
  }
  return { seeded: true, reason: null };
}

async function ensureTranscriptOpen(page) {
  const input = transcriptInput(page);
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const panelInteractive = await isTranscriptInteractive(page);
    const inputVisible = await input.isVisible().catch(() => false);
    if (inputVisible && panelInteractive) return true;

    const openDirect = page.locator('[data-testid="tools.transcript-toggle"]').first();
    if ((await openDirect.count()) && (await openDirect.isVisible().catch(() => false))) {
      await openDirect.click({ force: true });
      await page.waitForTimeout(350);
      if ((await input.isVisible().catch(() => false)) && (await isTranscriptInteractive(page))) return true;
    }

    const moreButton = page.locator('[data-testid="tools.more-button"]').first();
    if ((await moreButton.count()) && (await moreButton.isVisible().catch(() => false))) {
      await moreButton.click();
      await page.waitForTimeout(250);
      const moreTranscript = page.locator('[data-testid="tools.more.transcript-toggle"]').first();
      if (await moreTranscript.count()) {
        await moreTranscript.click({ force: true });
        await page.waitForTimeout(350);
        if ((await input.isVisible().catch(() => false)) && (await isTranscriptInteractive(page))) return true;
      }
    }

    // Avoid unconditional Meta+K because it can re-close an already-open transcript panel.
    await page.keyboard.press('Control+K').catch(() => {});
    await page.waitForTimeout(250);
    if ((await input.isVisible().catch(() => false)) && (await isTranscriptInteractive(page))) return true;
    if (process.platform === 'darwin') {
      await page.keyboard.press('Meta+K').catch(() => {});
      await page.waitForTimeout(250);
      if ((await input.isVisible().catch(() => false)) && (await isTranscriptInteractive(page))) return true;
    }

    await page.waitForTimeout(350);
  }
  return false;
}

async function maybeRequestAgent(page) {
  const notJoinedVisible = await page.getByText(/Agent not joined/i).first().isVisible().catch(() => false);
  if (!notJoinedVisible) return true;

  const requestAgent = page
    .locator('button:has-text("Request agent"), [role="button"]:has-text("Request agent"), a:has-text("Request agent")')
    .first();
  if (!(await requestAgent.count())) {
    return false;
  }

  const waitStart = Date.now();
  while (Date.now() - waitStart < 20_000) {
    const enabled = await requestAgent.isEnabled().catch(() => false);
    if (enabled) break;
    await page.waitForTimeout(300);
  }

  const canRequest = await requestAgent.isEnabled().catch(() => false);
  if (!canRequest) return false;

  await requestAgent.click();
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const joined = (await page.getByText(/Agent not joined/i).count().catch(() => 0)) === 0;
    if (joined) return true;
    await page.waitForTimeout(400);
  }
  return (await page.getByText(/Agent not joined/i).count().catch(() => 0)) === 0;
}

async function isRoomConnected(page) {
  const disconnectButton = page.getByRole('button', { name: /^Disconnect$/i }).first();
  const disconnectVisible = await disconnectButton.isVisible().catch(() => false);
  if (disconnectVisible) return true;

  const connectButton = page.getByRole('button', { name: /^Connect$/i }).first();
  const connectVisible = await connectButton.isVisible().catch(() => false);
  if (connectVisible) return false;

  const statusText = await page
    .evaluate(() => {
      const text = document.body.innerText || '';
      return /\bconnected\b/i.test(text) && !/\bdisconnected\b/i.test(text);
    })
    .catch(() => false);
  return Boolean(statusText);
}

async function maybeConnectRoom(page) {
  if (await isRoomConnected(page)) return true;
  const connectButton = page.getByRole('button', { name: /^Connect$/i }).first();
  if (!(await connectButton.count())) return false;

  const canConnect = await connectButton.isEnabled().catch(() => false);
  if (!canConnect) return false;

  await connectButton.click({ force: true });
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const connectedNow = await isRoomConnected(page);
    if (connectedNow) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function ensureRealtimeReady(page, timeoutMs = 30_000) {
  const started = Date.now();
  let connected = false;
  let agentJoined = false;
  while (Date.now() - started < timeoutMs) {
    await ensureTranscriptOpen(page);
    connected = await maybeConnectRoom(page);
    if (connected) {
      agentJoined = await maybeRequestAgent(page);
      if (agentJoined) {
        const input = transcriptInput(page);
        const visible = await input.isVisible().catch(() => false);
        const enabled = await input.isEnabled().catch(() => false);
        const placeholder = await input.getAttribute('placeholder').catch(() => null);
        const looksConnecting = typeof placeholder === 'string' && /connecting to livekit/i.test(placeholder);
        if (visible && enabled && !looksConnecting) {
          return { connected: true, agentJoined: true };
        }
      }
    }
    await page.waitForTimeout(500);
  }
  return {
    connected: await isRoomConnected(page),
    agentJoined: (await page.getByText(/Agent not joined/i).count().catch(() => 0)) === 0,
  };
}

async function sendTurn(page, prompt, timeoutMs, options = {}) {
  const attempts = Math.max(1, Number(options.attempts ?? 2));
  const input = transcriptInput(page);
  const sendButton = page.getByRole('button', { name: /^Send$/i }).first();
  let lastResult = {
    prompt,
    acked: false,
    beforeVoiceCount: await page.locator('text=voice-agent').count(),
    currentVoiceCount: await page.locator('text=voice-agent').count(),
    attemptsUsed: 0,
    connected: false,
    agentJoined: false,
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const readiness = await ensureRealtimeReady(page, Math.min(20_000, timeoutMs));
    const start = Date.now();
    while (Date.now() - start < 12_000) {
      const ready = await input.isVisible().catch(() => false);
      const enabled = await input.isEnabled().catch(() => false);
      if (ready && enabled) break;
      await page.waitForTimeout(250);
    }

    const beforeVoiceCount = await page.locator('text=voice-agent').count();
    await input.fill(prompt);
    const sendReadyStart = Date.now();
    let sendEnabled = false;
    while (Date.now() - sendReadyStart < 2_500) {
      sendEnabled = await sendButton.isEnabled().catch(() => false);
      if (sendEnabled) break;
      await page.waitForTimeout(120);
    }
    if (!sendEnabled) {
      lastResult = {
        prompt,
        acked: false,
        beforeVoiceCount,
        currentVoiceCount: beforeVoiceCount,
        attemptsUsed: attempt,
        connected: readiness.connected,
        agentJoined: readiness.agentJoined,
      };
      await page.waitForTimeout(500);
      continue;
    }

    if (await sendButton.isVisible().catch(() => false)) {
      await sendButton.click({ force: true });
    } else {
      await page.keyboard.press('Enter');
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const currentVoiceCount = await page.locator('text=voice-agent').count();
      if (currentVoiceCount > beforeVoiceCount) {
        await page.waitForTimeout(400);
        return {
          prompt,
          acked: true,
          beforeVoiceCount,
          currentVoiceCount,
          attemptsUsed: attempt,
          connected: readiness.connected,
          agentJoined: readiness.agentJoined,
        };
      }
      await page.waitForTimeout(400);
    }

    lastResult = {
      prompt,
      acked: false,
      beforeVoiceCount,
      currentVoiceCount: beforeVoiceCount,
      attemptsUsed: attempt,
      connected: readiness.connected,
      agentJoined: readiness.agentJoined,
    };
  }

  return lastResult;
}

async function fitCanvasToContent(page) {
  await page
    .evaluate(() => {
      const editor = window.__present?.tldrawEditor || window.__PRESENT__?.tldraw || window.editor;
      if (!editor) return;
      if (typeof editor.zoomToFit === 'function') {
        editor.zoomToFit();
        return;
      }
      if (typeof editor.zoomToContent === 'function') {
        editor.zoomToContent();
      }
    })
    .catch(() => {});
  await page.waitForTimeout(700);
}

function scoreSignals(text) {
  const lower = text.toLowerCase();
  return {
    timerVisible: /minute timer|timer/.test(lower),
    crowdPulseVisible: /crowd pulse/.test(lower),
    debateVisible: /debate/.test(lower),
    stickyMarkerVisible: /BUNNY_LOOKS_ENERGETIC/.test(text),
    secondStickyVisible: /FOREST_READY/.test(text),
    forestVisible: /forest|tree/.test(lower),
    fairyMentioned: /fairies|fairy/.test(lower),
    agentJoinedBannerMissing: !/agent not joined/i.test(text),
  };
}

const countBy = (values) =>
  values.reduce((acc, value) => {
    const key = typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

async function fetchSessionCorrelationViaSupabase(room, limit = 300) {
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

  const traceIds = new Set();
  const requestIds = new Set();
  for (const task of tasks) {
    const traceId = readString(task.trace_id);
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
      missingTraceOnTasks: tasks.filter((task) => !readString(task.trace_id)).length,
    },
    tasks,
    traces,
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const canvasId = randomUUID();
  const runId = `showcase-${Date.now()}-${canvasId.slice(0, 8)}`;
  const room = `canvas-${canvasId}`;
  const outputDir = path.join(args.outDir, runId);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({
    baseURL: args.baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1720, height: 980 },
    recordVideo: { dir: outputDir, size: { width: 1720, height: 980 } },
  });
  const page = await context.newPage();

  const turns = [
    'Start a five-minute timer widget near the top right.',
    'Create one Crowd Pulse widget titled Launch Readiness. Do not create duplicates.',
    'Update Crowd Pulse hand count to 12, confidence 0.78, and set question to: What excites you most about this release?',
    'Create one Debate Scorecard on topic: Should we ship Friday? Do not create duplicates.',
    'Update the debate with one affirmative claim: rollback plan is tested and release train is green. Then add one negative claim: auth edge cases remain unresolved.',
    'Have the fairies draw a clean bunny outline with simple shapes only: oval body, circle head, two ear lines, and a small tail circle.',
    'Have multiple fairies draw a simple forest scene around the bunny with three trees and one ground line.',
    'Use the fast Cerebras fairy path and add one sticky note near the bunny with exact text: BUNNY_LOOKS_ENERGETIC.',
    'Use the fast Cerebras fairy path and add one sticky note near the forest with exact text: FOREST_READY.',
  ].slice(0, Math.max(1, Math.min(args.maxTurns, 20)));

  const result = {
    runId,
    startedAt: nowIso(),
    baseUrl: args.baseUrl,
    canvasId,
    room,
    displayName: args.displayName,
    joined: false,
    transcriptOpened: false,
    turns: [],
    signals: null,
    sessionCorrelation: null,
    proof: null,
    screenshots: [],
    notes: [],
    endedAt: null,
  };

  try {
    const providedEmail = process.env.PLAYWRIGHT_EMAIL;
    const providedPassword = process.env.PLAYWRIGHT_PASSWORD;
    const authSeed = {
      ...(providedEmail && providedPassword
        ? { email: providedEmail, password: providedPassword, name: args.displayName }
        : buildAuthSeedCredentials()),
    };
    const seededUser = await ensureSeededAuthUser(authSeed);
    result.authSeed = seededUser;
    const authResult = await signInWithEmail(page, authSeed);
    result.auth = authResult;
    if (!authResult?.ok) {
      result.notes.push(`Auth sign-in did not complete: ${authResult?.error || 'unknown'}`);
    }

    await page.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    result.joined = await ensureJoin(page, args.displayName);

    result.transcriptOpened = await ensureTranscriptOpen(page);
    if (!result.transcriptOpened) {
      result.notes.push('Transcript input was not available.');
    }

    const readiness = await ensureRealtimeReady(page, 35_000);
    if (!readiness.connected) {
      result.notes.push('LiveKit did not report connected state before turns.');
    }

    if (!readiness.agentJoined) {
      result.notes.push('Agent request was unavailable or not confirmed before turns.');
    }

    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i];
      if (!result.transcriptOpened) break;
      const isFairyTurn = /fairies|sticky note|bunny|forest|cerebras/i.test(turn);
      const ack = await sendTurn(page, turn, Math.min(20_000, args.timeoutMs), {
        attempts: isFairyTurn ? 2 : 2,
      });
      result.turns.push(ack);
      process.stdout.write(
        `[showcase] turn ${String(i + 1).padStart(2, '0')}/${turns.length} ack=${ack.acked ? 'yes' : 'no'}\n`,
      );
      await page.waitForTimeout(3200);
      await fitCanvasToContent(page);
      const shot = path.join(outputDir, `turn-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      result.screenshots.push(shot);
    }

    await page.waitForTimeout(4000);
    await fitCanvasToContent(page);
    await ensureTranscriptOpen(page);
    await page.waitForTimeout(300);
    const finalShot = path.join(outputDir, 'final-showcase.png');
    await page.screenshot({ path: finalShot, fullPage: false });
    result.screenshots.push(finalShot);

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    result.signals = scoreSignals(bodyText);

    let sessionBody = null;
    try {
      sessionBody = await fetchSessionCorrelationViaSupabase(room, 300);
      if (sessionBody) {
        result.sessionCorrelation = {
          status: 200,
          ok: true,
          source: 'supabase',
          body: sessionBody,
        };
      } else {
        const sessionController = new AbortController();
        const sessionTimeout = setTimeout(() => {
          sessionController.abort();
        }, 10_000);
        try {
          const sessionResponse = await page.request.get(
            `/api/admin/agents/session?room=${encodeURIComponent(room)}&limit=300`,
            { signal: sessionController.signal },
          );
          sessionBody = await sessionResponse.json().catch(() => null);
          result.sessionCorrelation = {
            status: sessionResponse.status(),
            ok: sessionResponse.ok(),
            source: 'admin-endpoint',
            body: sessionBody,
          };
          if (!sessionResponse.ok()) {
            throw new Error('Session correlation endpoint was not accessible from this run context.');
          }
        } finally {
          clearTimeout(sessionTimeout);
        }
      }

      const summary =
        sessionBody?.summary && typeof sessionBody.summary === 'object' ? sessionBody.summary : {};
      const stageCounts =
        summary.traceStageCounts && typeof summary.traceStageCounts === 'object'
          ? summary.traceStageCounts
          : {};
      const actionsDispatchedCount = Number(stageCounts.actions_dispatched ?? 0);
      const completedCount = Number(stageCounts.completed ?? 0);
      const tasks = Array.isArray(sessionBody?.tasks) ? sessionBody.tasks : [];
      const traces = Array.isArray(sessionBody?.traces) ? sessionBody.traces : [];
      const fairySucceededTasks = tasks.filter((task) => {
        const taskName = readString(task?.task);
        const status = readString(task?.status)?.toLowerCase();
        return taskName === 'fairy.intent' && status === 'succeeded';
      });
      const cleanFairySucceededCount = fairySucceededTasks.filter(
        (task) => !readString(task?.error),
      ).length;
      const zodErrorCount = tasks.filter((task) => {
        const taskName = readString(task?.task);
        if (taskName !== 'fairy.intent') return false;
        const errorText = readString(task?.error)?.toLowerCase() ?? '';
        return errorText.includes('_zod');
      }).length;
      const dispatchedTraceCount = traces.filter(
        (trace) => readString(trace?.stage) === 'actions_dispatched',
      ).length;
      const completedFairyTraces = traces.filter((trace) => {
        const stage = readString(trace?.stage)?.toLowerCase();
        const task = readString(trace?.task);
        const status = readString(trace?.status)?.toLowerCase();
        return stage === 'completed' && task === 'fairy.intent' && status === 'succeeded';
      }).length;
      result.proof = {
        actionsDispatchedCount,
        completedCount,
        dispatchedTraceCount,
        completedFairyTraces,
        fairySucceededCount: fairySucceededTasks.length,
        cleanFairySucceededCount,
        zodErrorCount,
      };
      if (cleanFairySucceededCount < 1) {
        throw new Error('Showcase proof failed: no clean succeeded fairy.intent task found for room.');
      }
      if (zodErrorCount > 0) {
        throw new Error(`Showcase proof failed: detected ${zodErrorCount} fairy.intent _zod error(s).`);
      }
      if (completedFairyTraces < 1) {
        throw new Error('Showcase proof failed: no completed fairy.intent trace found for room.');
      }
      if (!result.signals?.stickyMarkerVisible || !result.signals?.secondStickyVisible) {
        throw new Error('Showcase proof failed: expected sticky-note markers were not visible.');
      }
      result.notes.push(
        `Proof linked: completed=${completedCount}, actions_dispatched=${actionsDispatchedCount}, fairy_completed=${completedFairyTraces}, fairy_clean_succeeded=${cleanFairySucceededCount}`,
      );
    } catch (error) {
      if (!result.sessionCorrelation) {
        result.sessionCorrelation = {
          status: 0,
          ok: false,
          body: null,
        };
      }
      result.notes.push(
        `Session correlation request failed: ${describeError(error)}`,
      );
    }
  } catch (error) {
    result.notes.push(describeError(error));
    const errShot = path.join(outputDir, 'error.png');
    await page.screenshot({ path: errShot, fullPage: true }).catch(() => {});
    result.screenshots.push(errShot);
  } finally {
    const videoPath = await page.video()?.path().catch(() => null);
    if (videoPath) {
      result.video = videoPath;
    }
    result.endedAt = nowIso();
    await fs.writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    await context.close();
    await browser.close();
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(
    `[playwright-voice-showcase-loop] failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exit(1);
});

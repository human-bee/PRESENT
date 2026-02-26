#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import { writeAgentTraceHtml } from './render-agent-trace-html.mjs';

const nowIso = () => new Date().toISOString();
const readString = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
const traceLog = (step, extra) => {
  const suffix = readString(extra) ? ` ${extra}` : '';
  process.stdout.write(`[trace-replay] ${step}${suffix}\n`);
};

const withTimeout = async (promise, timeoutMs, fallback) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

for (const candidate of ['.env.local', '.env.development.local', '.env']) {
  loadDotenv({ path: path.join(process.cwd(), candidate), override: false });
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    canvasId: readString(process.env.PLAYWRIGHT_CANVAS_ID),
    displayName: process.env.PLAYWRIGHT_DISPLAY_NAME || 'Codex Trace Replay',
    outDir: path.join(process.cwd(), 'artifacts', 'trace-replays'),
    timeoutMs: 90_000,
    headless: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value) continue;
    if (value === '--headed') args.headless = false;
    else if (value.startsWith('--baseUrl=')) args.baseUrl = value.split('=').slice(1).join('=');
    else if (value.startsWith('--canvasId=')) args.canvasId = readString(value.split('=').slice(1).join(''));
    else if (value.startsWith('--displayName=')) args.displayName = value.split('=').slice(1).join('=');
    else if (value.startsWith('--outDir=')) args.outDir = value.split('=').slice(1).join('=');
    else if (value.startsWith('--timeoutMs=')) args.timeoutMs = Number(value.split('=').slice(1).join('')) || args.timeoutMs;
  }
  return args;
}

const isMac = process.platform === 'darwin';

async function waitForCompileIdle(page, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const compilingVisible = await page
      .locator('text=/Compiling\\.\\.\\.|Compiling\\s*…|Building\\s*…|Building\\.\\.\\./i')
      .first()
      .isVisible()
      .catch(() => false);
    if (!compilingVisible) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function seedAuthUser(canvasId) {
  const requestedEmail = readString(process.env.PLAYWRIGHT_EMAIL);
  const requestedPassword = readString(process.env.PLAYWRIGHT_PASSWORD);
  if (requestedEmail && requestedPassword) {
    return { email: requestedEmail, password: requestedPassword, seeded: false, reason: 'provided_credentials' };
  }

  const url = readString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = readString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const email = `trace-replay-${Date.now()}-${canvasId.slice(0, 8)}@present.local`;
  const password = readString(process.env.PLAYWRIGHT_REPLAY_PASSWORD) || 'Devtools!FixedA1';
  if (!url || !serviceRoleKey) {
    return { email, password, seeded: false, reason: 'missing_supabase_admin_env' };
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Codex Trace Replay' },
  });
  return {
    email,
    password,
    seeded: !error,
    reason: error ? error.message || 'create_user_failed' : null,
  };
}

async function signIn(page, credentials, timeoutMs) {
  const maxTimeout = Math.max(30_000, timeoutMs);
  await page.goto('/auth/signin', { waitUntil: 'domcontentloaded', timeout: maxTimeout });
  await waitForCompileIdle(page, Math.min(35_000, maxTimeout)).catch(() => {});
  const email = page.locator('#email, input[type="email"], input[name="email"]').first();
  const password = page.locator('#password, input[type="password"], input[name="password"]').first();
  const submit = page.locator('button[type="submit"]').first();
  await email.waitFor({ state: 'visible', timeout: 30_000 });
  await password.waitFor({ state: 'visible', timeout: 30_000 });

  const ensureStableFieldValue = async (field, expected, attempts = 5) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await field.click().catch(() => {});
      await field.fill(expected);
      await page.waitForTimeout(200);
      const current = await field.inputValue().catch(() => '');
      if (current !== expected) {
        await page.waitForTimeout(250);
        continue;
      }
      await field.press('Tab').catch(() => {});
      await page.waitForTimeout(250);
      const persisted = await field.inputValue().catch(() => '');
      if (persisted === expected) {
        return true;
      }
      await page.waitForTimeout(300);
    }
    return false;
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const emailStable = await ensureStableFieldValue(email, credentials.email);
    const passwordStable = await ensureStableFieldValue(password, credentials.password);
    if (!emailStable || !passwordStable) {
      await page.waitForTimeout(400);
      continue;
    }

    const enabled = await submit.isEnabled().catch(() => false);
    if (enabled) {
      await submit.click({ force: true }).catch(() => {});
    } else {
      await password.press('Enter').catch(() => {});
    }

    const signedIn = await page
      .waitForURL(/\/canvas/i, { timeout: 20_000 })
      .then(() => true)
      .catch(() => /\/canvas/i.test(page.url()));
    if (signedIn) return { ok: true, mode: 'signin' };

    const hasAuthToken = await page
      .evaluate(() => Object.keys(window.localStorage || {}).some((key) => /auth-token/i.test(key)))
      .catch(() => false);
    if (hasAuthToken) {
      await page.goto('/canvas', { waitUntil: 'domcontentloaded', timeout: maxTimeout }).catch(() => {});
      const reachedCanvas = await page
        .waitForURL(/\/canvas/i, { timeout: 25_000 })
        .then(() => true)
        .catch(() => /\/canvas/i.test(page.url()));
      if (reachedCanvas) return { ok: true, mode: 'signin_fallback_canvas_nav' };
    }

    await waitForCompileIdle(page, 10_000).catch(() => {});
  }

  const signInErrorText = await page
    .locator('text=Invalid email or password, text=Something went wrong, .text-danger')
    .first()
    .textContent()
    .catch(() => null);
  return { ok: false, mode: 'signin', error: signInErrorText || 'Sign-in did not reach /canvas' };
}

async function ensureJoin(page, displayName) {
  const joinButton = page.locator('button:has-text("Join")').first();
  const hasJoin = await joinButton.isVisible().catch(() => false);
  if (!hasJoin) return;
  const nameInput = page.locator('input').first();
  await nameInput.fill(displayName);
  await joinButton.click();
  await page.waitForTimeout(1200);
}

async function openTranscript(page) {
  const shortcut = isMac ? 'Meta+KeyK' : 'Control+KeyK';
  const candidates = page.locator(
    [
      'input[placeholder*="Type a message for the agent"]',
      'textarea[placeholder*="Type a message for the agent"]',
      'input[placeholder*="message for the agent"]',
      'textarea[placeholder*="message for the agent"]',
      'input[placeholder*="Connecting to LiveKit"]',
      'textarea[placeholder*="Connecting to LiveKit"]',
    ].join(', '),
  );

  const started = Date.now();
  while (Date.now() - started < 20_000) {
    await page.keyboard.press(shortcut).catch(() => {});
    const count = await candidates.count().catch(() => 0);
    const viewport = page.viewportSize() || { width: 1720, height: 980 };
    for (let i = 0; i < count; i += 1) {
      const input = candidates.nth(i);
      const visible = await input.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await input.boundingBox().catch(() => null);
      if (!box) continue;
      const inViewport =
        box.width > 0 &&
        box.height > 0 &&
        box.x < viewport.width &&
        box.y < viewport.height &&
        box.x + box.width > 0 &&
        box.y + box.height > 0;
      if (inViewport) {
        return input;
      }
    }
    await page.waitForTimeout(350).catch(() => {});
  }

  throw new Error('Transcript input did not become visible');
}

async function isRoomConnected(page) {
  const connectedFlag = await page
    .waitForFunction(() => Boolean(window.__present?.livekitConnected), null, { timeout: 1_200 })
    .then(() => true)
    .catch(() => false);
  if (connectedFlag) return true;

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
  const connectVisible = await connectButton.isVisible().catch(() => false);
  if (!connectVisible) return false;
  const canConnect = await connectButton.isEnabled().catch(() => false);
  if (!canConnect) return false;
  let clicked = false;
  try {
    await connectButton.scrollIntoViewIfNeeded().catch(() => {});
    await connectButton.click({ force: true, timeout: 4_000 });
    clicked = true;
  } catch {
    clicked = await page
      .evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find((button) => /^connect$/i.test((button.textContent || '').trim()));
        if (!target) return false;
        target.click();
        return true;
      })
      .catch(() => false);
  }
  if (!clicked) return false;
  const started = Date.now();
  while (Date.now() - started < 18_000) {
    if (await isRoomConnected(page)) return true;
    await page.waitForTimeout(350);
  }
  return false;
}

async function ensureRealtimeReady(page, transcriptInput, roomName, timeoutMs = 25_000) {
  const started = Date.now();
  let connected = false;
  let agentReady = false;
  while (Date.now() - started < timeoutMs) {
    connected = await maybeConnectRoom(page);
    if (connected) {
      await requestAgent(page, roomName).catch(() => {});
      agentReady = await waitForAgent(page);
      if (agentReady) {
        const visible = await transcriptInput.isVisible().catch(() => false);
        const enabled = await transcriptInput.isEnabled().catch(() => false);
        const placeholder = await transcriptInput.getAttribute('placeholder').catch(() => null);
        const looksConnecting = typeof placeholder === 'string' && /connecting to livekit/i.test(placeholder);
        if (visible && enabled && !looksConnecting) {
          return { connected: true, agentReady: true };
        }
      }
    }
    await page.waitForTimeout(400);
  }
  return { connected: await isRoomConnected(page), agentReady: await waitForAgent(page) };
}

async function resolveRoom(page, canvasId) {
  const room = await page
    .evaluate(() => {
      const present = window.__present ?? {};
      const candidate =
        present.livekitRoomName ?? present.syncContract?.livekitRoomName ?? present.sessionSync?.roomName ?? null;
      if (typeof candidate !== 'string') return null;
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : null;
    })
    .catch(() => null);
  return room || `canvas-${canvasId}`;
}

async function requestAgent(page, roomName) {
  await page
    .evaluate(async ({ roomName: targetRoom }) => {
      await fetch('/api/agent/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomName: targetRoom }),
      }).catch(() => {});
    }, { roomName })
    .catch(() => {});
}

async function waitForAgent(page) {
  return page
    .waitForFunction(() => {
      const present = window.__present ?? {};
      if (present.livekitHasAgent === true) return true;
      const identities = Array.isArray(present.livekitRemoteParticipantIdentities)
        ? present.livekitRemoteParticipantIdentities
        : [];
      return identities.some((value) => {
        const lower = String(value || '').toLowerCase();
        return lower.startsWith('agent_') || lower.includes('voice-agent');
      });
    }, null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

async function transcriptLineCount(page) {
  return page
    .evaluate(() => {
      const panel = document.querySelector('[data-present-transcript-panel="true"]');
      if (!panel) return 0;
      return panel.querySelectorAll('div.text-sm').length;
    })
    .catch(() => 0);
}

async function sendTurn(page, input, text) {
  const beforeLines = await transcriptLineCount(page);
  const beforeVoiceCount = await page.locator('text=voice-agent').count().catch(() => 0);
  const startedAt = Date.now();
  await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).first().click();

  const acked = await page
    .waitForFunction(
      (minCount) => {
        const panel = document.querySelector('[data-present-transcript-panel="true"]');
        if (!panel) return false;
        return panel.querySelectorAll('div.text-sm').length > minCount;
      },
      beforeLines,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);

  const deliveredByVoiceAgent = await page
    .waitForFunction(
      (minVoiceCount) => {
        const entries = Array.from(document.querySelectorAll('[data-present-transcript-panel=\"true\"] div'));
        const voiceEntries = entries.filter((entry) =>
          (entry.textContent || '').toLowerCase().includes('voice-agent'),
        );
        return voiceEntries.length > minVoiceCount;
      },
      beforeVoiceCount,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);

  const deliveredByAnyLine = await page
    .waitForFunction(
      (minCount) => {
        const panel = document.querySelector('[data-present-transcript-panel="true"]');
        if (!panel) return false;
        return panel.querySelectorAll('div.text-sm').length > minCount + 1;
      },
      beforeLines,
      { timeout: 3_000 },
    )
    .then(() => true)
    .catch(() => false);

  await page.waitForTimeout(1200).catch(() => {});
  return {
    prompt: text,
    acked,
    delivered: deliveredByVoiceAgent || deliveredByAnyLine,
    deliveredByVoiceAgent,
    elapsedMs: Date.now() - startedAt,
  };
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  const rank = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[rank];
}

async function run() {
  const args = parseArgs(process.argv);
  const canvasId = readString(args.canvasId);
  if (!canvasId) {
    throw new Error('Missing required --canvasId=<uuid>');
  }

  const runId = `trace-replay-${Date.now()}-${canvasId.slice(0, 8)}`;
  const outputDir = path.join(args.outDir, runId);
  await fs.mkdir(outputDir, { recursive: true });
  traceLog('run.start', `runId=${runId} canvasId=${canvasId}`);

  const credentials = await seedAuthUser(canvasId);
  traceLog('auth.seeded', `email=${credentials.email} seeded=${String(credentials.seeded)}`);
  const result = {
    runId,
    canvasId,
    room: `canvas-${canvasId}`,
    startedAt: nowIso(),
    endedAt: null,
    auth: credentials,
    connected: false,
    agentReady: false,
    turns: [],
    metrics: null,
    screenshots: [],
    video: null,
    agentTraceHtml: null,
    notes: [],
  };

  const marker = `NEW_REPLAY_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const turns = [
    'Start a five-minute timer near the top right.',
    'Update that same timer to seven minutes and keep exactly one timer.',
    `Create a sticky note near x=120 y=120 with exact text ${marker}. If it already exists, update it instead of duplicating.`,
    'Create one sticky note near x=120 y=220 with exact text STABLE_AND_FASTER. If it exists, update it.',
    'Add plain text FAST_PATH_HEALTHCHECK near the center.',
    'Draw a graph of y equals x squared. If direct graphing is unsupported, draw a simple parabola sketch instead, and do not crash.',
  ];

  let browser = null;
  let context = null;
  let page = null;
  let pageVideo = null;
  try {
    traceLog('browser.launch');
    browser = await chromium.launch({ headless: args.headless });
    context = await browser.newContext({
      baseURL: args.baseUrl,
      ignoreHTTPSErrors: true,
      viewport: { width: 1720, height: 980 },
      recordVideo: { dir: outputDir, size: { width: 1720, height: 980 } },
    });
    await context.addInitScript(() => {
      window.__presentDispatcherMetrics = true;
      window.__traceReplayMetrics = [];
      window.addEventListener('present:tool_metrics', (event) => {
        const detail = event?.detail;
        if (!detail || typeof detail !== 'object') return;
        if (typeof detail.dtPaintMs !== 'number' || Number.isNaN(detail.dtPaintMs)) return;
        window.__traceReplayMetrics.push({
          tool: typeof detail.tool === 'string' ? detail.tool : null,
          messageId: typeof detail.messageId === 'string' ? detail.messageId : null,
          dtPaintMs: detail.dtPaintMs,
          tPaint: Date.now(),
        });
      });
    });
    page = await context.newPage();
    pageVideo = page.video();

    traceLog('auth.signin.start');
    const authResult = await signIn(page, credentials, args.timeoutMs);
    traceLog('auth.signin.done', `ok=${String(authResult.ok)} mode=${authResult.mode || 'unknown'}`);
    if (!authResult.ok) {
      result.notes.push(`Sign-in was not confirmed (${authResult.error || 'unknown'}); proceeding via direct canvas route.`);
    }

    traceLog('canvas.goto.start');
    await page.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(45_000, args.timeoutMs),
    });
    traceLog('canvas.goto.done');
    await waitForCompileIdle(page, 20_000).catch(() => {});
    await ensureJoin(page, args.displayName);
    traceLog('canvas.join.done');
    traceLog('transcript.open.start');
    const transcriptInput = await openTranscript(page);
    traceLog('transcript.open.done');
    const roomName = await resolveRoom(page, canvasId);
    result.room = roomName;
    traceLog('room.resolved', roomName);
    const readiness = await ensureRealtimeReady(page, transcriptInput, roomName, 35_000);
    result.connected = readiness.connected;
    result.agentReady = readiness.agentReady;
    traceLog('livekit.connected', `ok=${String(result.connected)}`);
    traceLog('agent.ready', `ok=${String(result.agentReady)}`);
    if (!result.agentReady) {
      result.notes.push('Voice agent was not positively detected before turns; replay still captured.');
    }

    const hasSession = await page
      .waitForFunction(
        () => {
          const sessionId = window.__present?.sessionSync?.sessionId;
          return typeof sessionId === 'string' && sessionId.length > 0;
        },
        null,
        { timeout: 12_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!hasSession) {
      result.notes.push('Session sync id was not observed before turns.');
    }

    for (let i = 0; i < turns.length; i += 1) {
      await ensureRealtimeReady(page, transcriptInput, roomName, 12_000).catch(() => {});
      const outcome = await sendTurn(page, transcriptInput, turns[i]);
      result.turns.push(outcome);
      process.stdout.write(
        `[trace-replay] turn ${String(i + 1).padStart(2, '0')}/${turns.length} ack=${outcome.acked ? 'yes' : 'no'} delivered=${outcome.delivered ? 'yes' : 'no'} elapsed=${outcome.elapsedMs}ms\n`,
      );
      const screenshot = path.join(outputDir, `turn-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {});
      result.screenshots.push(screenshot);
      await page.waitForTimeout(1200).catch(() => {});
    }

    const finalShot = path.join(outputDir, 'final.png');
    await page.screenshot({ path: finalShot, fullPage: false }).catch(() => {});
    result.screenshots.push(finalShot);

    const rawMetrics = await page.evaluate(() => {
      return Array.isArray(window.__traceReplayMetrics) ? window.__traceReplayMetrics : [];
    });
    const paintSamples = rawMetrics
      .map((entry) => (entry && typeof entry.dtPaintMs === 'number' ? entry.dtPaintMs : null))
      .filter((entry) => typeof entry === 'number' && Number.isFinite(entry))
      .sort((a, b) => a - b);
    result.metrics = {
      sampleCount: paintSamples.length,
      p50Ms: percentile(paintSamples, 0.5),
      p95Ms: percentile(paintSamples, 0.95),
      samples: paintSamples,
    };
  } catch (error) {
    traceLog('run.error', error instanceof Error ? error.message : String(error));
    result.notes.push(error instanceof Error ? error.message : String(error));
    if (page) {
      const errShot = path.join(outputDir, 'error.png');
      await page.screenshot({ path: errShot, fullPage: true }).catch(() => {});
      result.screenshots.push(errShot);
    }
  } finally {
    traceLog('run.finally.start');
    result.endedAt = nowIso();
    if (context) {
      traceLog('context.close.start');
      const closed = await withTimeout(
        context.close().then(() => true).catch(() => false),
        12_000,
        false,
      );
      traceLog('context.close.done', `ok=${String(closed)}`);
      if (!closed) {
        result.notes.push('Context close timed out; video may be partial.');
      }
    }
    if (pageVideo) {
      traceLog('video.path.start');
      result.video = await pageVideo.path().catch(() => null);
      traceLog('video.path.done', `path=${result.video || 'null'}`);
    }
    if (browser) {
      traceLog('browser.close.start');
      await withTimeout(
        browser.close().then(() => true).catch(() => false),
        8_000,
        false,
      );
      traceLog('browser.close.done');
    }
    if (!result.video) {
      const entries = await fs.readdir(outputDir).catch(() => []);
      const webm = entries.find((entry) => entry.toLowerCase().endsWith('.webm'));
      if (webm) {
        result.video = path.join(outputDir, webm);
        traceLog('video.path.fallback', result.video);
      }
    }
    await fs.writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    try {
      result.agentTraceHtml = await writeAgentTraceHtml({
        result,
        outputDir,
      });
    } catch (error) {
      result.notes.push(`Agent trace HTML write failed: ${error instanceof Error ? error.message : String(error)}`);
      result.agentTraceHtml = null;
    }
    await fs.writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    traceLog('result.written', path.join(outputDir, 'result.json'));
    console.log(JSON.stringify(result, null, 2));
  }
}

run().catch((error) => {
  console.error('[trace-replay] failed', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

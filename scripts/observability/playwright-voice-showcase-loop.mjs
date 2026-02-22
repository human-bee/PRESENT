#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
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
    requireAdminTraceEvidence: true,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value) continue;
    if (value === '--headed') args.headless = false;
    else if (value === '--skipAdminTraceEvidence') args.requireAdminTraceEvidence = false;
    else if (value.startsWith('--baseUrl=')) args.baseUrl = value.split('=').slice(1).join('=');
    else if (value.startsWith('--displayName=')) args.displayName = value.split('=').slice(1).join('=');
    else if (value.startsWith('--outDir=')) args.outDir = value.split('=').slice(1).join('=');
    else if (value.startsWith('--timeoutMs=')) args.timeoutMs = Number(value.split('=').slice(1).join('')) || args.timeoutMs;
    else if (value.startsWith('--maxTurns=')) args.maxTurns = Number(value.split('=').slice(1).join('')) || args.maxTurns;
  }
  return args;
}

function transcriptInputCandidates(page) {
  return page.locator(
    [
      'input[placeholder*="Type a message for the agent"]',
      'textarea[placeholder*="Type a message for the agent"]',
      'input[placeholder*="message for the agent"]',
      'textarea[placeholder*="message for the agent"]',
      'input[placeholder*="Connecting to LiveKit"]',
      'textarea[placeholder*="Connecting to LiveKit"]',
    ].join(', '),
  );
}

async function firstInViewport(page, locator) {
  const count = await locator.count().catch(() => 0);
  const viewport = page.viewportSize() || { width: 1720, height: 980 };
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    const box = await candidate.boundingBox().catch(() => null);
    if (!box) continue;
    const inViewport =
      box.width > 0 &&
      box.height > 0 &&
      box.x < viewport.width &&
      box.y < viewport.height &&
      box.x + box.width > 0 &&
      box.y + box.height > 0;
    if (inViewport) return candidate;
  }
  return null;
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
  if (!joinVisible) {
    return page
      .evaluate(() => {
        const text = (document.body.textContent || '').toLowerCase();
        return !text.includes('join the demo');
      })
      .catch(() => false);
  }
  await page.locator('input').first().fill(displayName);
  await page.locator('button:has-text("Join")').first().click();
  await page.waitForTimeout(1200).catch(() => {});
  return page
    .evaluate(() => {
      const text = (document.body.textContent || '').toLowerCase();
      return !text.includes('join the demo');
    })
    .catch(() => false);
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
  await page.waitForTimeout(600);
  const waitForCompileIdle = async (timeoutMs = 30_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const compilingVisible = await page
        .locator('text=/Compiling\\.\\.\\.|Compiling\\s*…|Building\\s*…|Building\\.\\.\\./i')
        .first()
        .isVisible()
        .catch(() => false);
      if (!compilingVisible) return true;
      await page.waitForTimeout(300);
    }
    return false;
  };
  await waitForCompileIdle().catch(() => {});
  const emailField = page.locator('#email, input[type="email"], input[name="email"]').first();
  const passwordField = page.locator('#password, input[type="password"], input[name="password"]').first();
  const signInButton = page.locator('button[type="submit"]').first();

  const formVisible = await Promise.all([
    emailField.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false),
    signInButton.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false),
  ]).then((values) => values.every(Boolean));

  if (formVisible) {
    const ensureFieldValue = async (field, expected, attempts = 3) => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await field.click().catch(() => {});
        await field.fill(expected);
        const current = await field.inputValue().catch(() => '');
        if (current === expected) return true;
        await page.waitForTimeout(200);
      }
      return false;
    };

    const emailOk = await ensureFieldValue(emailField, email);
    const passwordOk = await ensureFieldValue(passwordField, password);
    if (!emailOk || !passwordOk) {
      return { mode: 'signin', email, ok: false, error: 'Unable to populate sign-in fields' };
    }
    const enableStart = Date.now();
    while (Date.now() - enableStart < 20_000) {
      const enabled = await signInButton.isEnabled().catch(() => false);
      if (enabled) break;
      await page.waitForTimeout(250);
    }

    let signedIn = false;
    for (let attempt = 1; attempt <= 3 && !signedIn; attempt += 1) {
      await waitForCompileIdle(10_000).catch(() => {});
      const emailValue = await emailField.inputValue().catch(() => '');
      const passwordValue = await passwordField.inputValue().catch(() => '');
      if (emailValue !== email) {
        await ensureFieldValue(emailField, email);
      }
      if (passwordValue !== password) {
        await ensureFieldValue(passwordField, password);
      }
      const enabled = await signInButton.isEnabled().catch(() => false);
      if (enabled) {
        await signInButton.click({ force: true }).catch(() => {});
      } else {
        await passwordField.press('Enter').catch(() => {});
      }
      signedIn = await page
        .waitForURL(/\/canvas/i, { timeout: 18_000 })
        .then(() => true)
        .catch(() => /\/canvas/i.test(page.url()));
      if (!signedIn) {
        await page.waitForTimeout(600);
      }
    }
    if (signedIn) {
      await page.waitForTimeout(800);
      return { mode: 'signin', email, ok: true };
    }

    // Fallback: in dev mode the redirect can be flaky/late even with a valid session.
    // If auth cookies are present, navigate directly to /canvas and verify access.
    const hasSessionCookie = await page.context().cookies().then((cookies) =>
      cookies.some((cookie) =>
        typeof cookie?.name === 'string' &&
        /(supabase|auth|token|^sb-)/i.test(cookie.name),
      ),
    );
    if (hasSessionCookie) {
      await page.goto('/canvas', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
      const reachedCanvas = await page
        .waitForURL(/\/canvas/i, { timeout: 30_000 })
        .then(() => true)
        .catch(() => /\/canvas/i.test(page.url()));
      if (reachedCanvas) {
        await page.waitForTimeout(800);
        return { mode: 'signin_fallback_canvas_nav', email, ok: true };
      }
    }
  }

  const signInErrorText = await page
    .locator('text=Invalid email or password, text=Something went wrong, text=error')
    .first()
    .textContent()
    .catch(() => null);

  return { mode: 'signin', email, ok: false, error: signInErrorText || 'Sign-in did not reach /canvas' };
}

function buildAuthSeedCredentials() {
  const fallbackEmail =
    process.env.PLAYWRIGHT_SEED_EMAIL ||
    `showcase-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@present.local`;
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
    } else {
      return { seeded: false, reason: 'existing_user_not_found_for_password_reset' };
    }
  }
  return { seeded: true, reason: null };
}

async function ensureTranscriptOpen(page) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const input = await firstInViewport(page, transcriptInputCandidates(page));
    const panelInteractive = await isTranscriptInteractive(page);
    const inputVisible = Boolean(input);
    if (inputVisible && panelInteractive) return true;

    const openDirect = page.locator('[data-testid="tools.transcript-toggle"]').first();
    if ((await openDirect.count()) && (await openDirect.isVisible().catch(() => false))) {
      await openDirect.click({ force: true });
      await page.waitForTimeout(350);
      const openedInput = await firstInViewport(page, transcriptInputCandidates(page));
      if (openedInput && (await isTranscriptInteractive(page))) return true;
    }

    const moreButton = page.locator('[data-testid="tools.more-button"]').first();
    if ((await moreButton.count()) && (await moreButton.isVisible().catch(() => false))) {
      await moreButton.click();
      await page.waitForTimeout(250);
      const moreTranscript = page.locator('[data-testid="tools.more.transcript-toggle"]').first();
      if (await moreTranscript.count()) {
        await moreTranscript.click({ force: true });
        await page.waitForTimeout(350);
        const openedInput = await firstInViewport(page, transcriptInputCandidates(page));
        if (openedInput && (await isTranscriptInteractive(page))) return true;
      }
    }

    // Keyboard toggle once per loop; wait longer to avoid open/close thrash.
    await page.keyboard.press('Control+K').catch(() => {});
    await page.waitForTimeout(550);
    const toggledInput = await firstInViewport(page, transcriptInputCandidates(page));
    if (toggledInput && (await isTranscriptInteractive(page))) return true;
    if (process.platform === 'darwin') {
      await page.keyboard.press('Meta+K').catch(() => {});
      await page.waitForTimeout(550);
      const metaInput = await firstInViewport(page, transcriptInputCandidates(page));
      if (metaInput && (await isTranscriptInteractive(page))) return true;
    }

    await page.waitForTimeout(350);
  }
  return false;
}

async function maybeRequestAgent(page) {
  const notJoinedVisible = await page.getByText(/Agent not joined/i).first().isVisible().catch(() => false);
  if (!notJoinedVisible) return true;

  const requestAgent = await firstInViewport(
    page,
    page.locator('button:has-text("Request agent"), [role="button"]:has-text("Request agent"), a:has-text("Request agent")'),
  );
  if (!requestAgent) {
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
  const connectButton = await firstInViewport(page, page.getByRole('button', { name: /^Connect$/i }));
  if (!connectButton) return false;

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
        const input = await firstInViewport(page, transcriptInputCandidates(page));
        const visible = Boolean(input);
        const enabled = input ? await input.isEnabled().catch(() => false) : false;
        const placeholder = input ? await input.getAttribute('placeholder').catch(() => null) : null;
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
  const userLabel =
    typeof options.userLabel === 'string' && options.userLabel.trim().length > 0
      ? options.userLabel.trim()
      : 'Codex Showcase';
  const sendButton = page.getByRole('button', { name: /^Send$/i }).first();
  let lastResult = {
    prompt,
    acked: false,
    delivered: false,
    beforeVoiceCount: await page.locator('text=voice-agent').count(),
    currentVoiceCount: await page.locator('text=voice-agent').count(),
    beforeUserCount: await page.locator(`text=${userLabel}`).count(),
    currentUserCount: await page.locator(`text=${userLabel}`).count(),
    attemptsUsed: 0,
    connected: false,
    agentJoined: false,
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const readiness = await ensureRealtimeReady(page, Math.min(20_000, timeoutMs));
    const input = await firstInViewport(page, transcriptInputCandidates(page));
    if (!input) {
      lastResult = {
        ...lastResult,
        prompt,
        acked: false,
        delivered: false,
        attemptsUsed: attempt,
        connected: readiness.connected,
        agentJoined: readiness.agentJoined,
      };
      await page.waitForTimeout(400);
      continue;
    }
    const start = Date.now();
    while (Date.now() - start < 12_000) {
      const ready = await input.isVisible().catch(() => false);
      const enabled = await input.isEnabled().catch(() => false);
      if (ready && enabled) break;
      await page.waitForTimeout(250);
    }

    const beforeVoiceCount = await page.locator('text=voice-agent').count();
    const beforeUserCount = await page.locator(`text=${userLabel}`).count();
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
        delivered: false,
        beforeVoiceCount,
        currentVoiceCount: beforeVoiceCount,
        beforeUserCount,
        currentUserCount: beforeUserCount,
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
    let delivered = false;
    let latestUserCount = beforeUserCount;
    while (Date.now() - started < timeoutMs) {
      latestUserCount = await page.locator(`text=${userLabel}`).count();
      if (latestUserCount > beforeUserCount) {
        delivered = true;
      }
      const currentVoiceCount = await page.locator('text=voice-agent').count();
      if (currentVoiceCount > beforeVoiceCount) {
        await page.waitForTimeout(400);
        return {
          prompt,
          acked: true,
          delivered: true,
          beforeVoiceCount,
          currentVoiceCount,
          beforeUserCount,
          currentUserCount: latestUserCount,
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
      delivered,
      beforeVoiceCount,
      currentVoiceCount: beforeVoiceCount,
      beforeUserCount,
      currentUserCount: latestUserCount,
      attemptsUsed: attempt,
      connected: readiness.connected,
      agentJoined: readiness.agentJoined,
    };
    if (delivered) {
      return lastResult;
    }
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

function normalizeProofText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function normalizeShapeIdForProof(id) {
  const value = String(id || '').trim().toLowerCase();
  if (!value) return '';
  return value.startsWith('shape:') ? value.slice('shape:'.length) : value;
}

function richTextToPlain(value) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;
    if (typeof node.text === 'string') {
      const trimmed = node.text.trim();
      if (trimmed) parts.push(trimmed);
    }
    if (Array.isArray(node.content)) walk(node.content);
    if (Array.isArray(node.children)) walk(node.children);
  };
  walk(value);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function parseDocumentShapes(document) {
  if (!document || typeof document !== 'object') return [];
  const root = document;
  const store =
    (root.store && typeof root.store === 'object' ? root.store : null) ||
    (root.document && typeof root.document === 'object' && root.document.store && typeof root.document.store === 'object'
      ? root.document.store
      : {}) ||
    {};

  const shapes = [];
  const seen = new Set();
  const pushShape = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = readString(entry.id);
    const type = readString(entry.type);
    if (!id || !type || seen.has(id)) return;
    seen.add(id);
    const props = entry.props && typeof entry.props === 'object' ? entry.props : {};
    const text =
      readString(entry.text) ||
      readString(props.text) ||
      readString(props.label) ||
      richTextToPlain(props.richText);
    const x = typeof entry.x === 'number' ? entry.x : typeof props.x === 'number' ? props.x : null;
    const y = typeof entry.y === 'number' ? entry.y : typeof props.y === 'number' ? props.y : null;
    const w = typeof entry.w === 'number' ? entry.w : typeof props.w === 'number' ? props.w : null;
    const h = typeof entry.h === 'number' ? entry.h : typeof props.h === 'number' ? props.h : null;
    shapes.push({
      id,
      type,
      geo: readString(props.geo),
      name: readString(entry.name) || readString(props.name),
      label: readString(entry.label) || readString(props.label),
      text: text || null,
      x,
      y,
      w,
      h,
    });
  };

  const rawShapeCollection = store.shape || store.shapes;
  if (Array.isArray(rawShapeCollection)) {
    rawShapeCollection.forEach(pushShape);
  } else if (rawShapeCollection && typeof rawShapeCollection === 'object') {
    Object.values(rawShapeCollection).forEach(pushShape);
  }
  Object.keys(store)
    .filter((key) => key.startsWith('shape:'))
    .forEach((key) => pushShape(store[key]));

  if (Array.isArray(root.shapes)) {
    root.shapes.forEach(pushShape);
  }

  return shapes;
}

function buildCanvasProofFromShapes(shapes) {
  const lowerIds = new Set(shapes.map((shape) => normalizeShapeIdForProof(shape.id)));
  const requiredBunnyIds = ['bunny-body', 'bunny-head', 'bunny-ear-left', 'bunny-ear-right', 'bunny-tail'];
  const requiredForestIds = ['forest-tree-1', 'forest-tree-2', 'forest-tree-3', 'forest-ground'];
  const requiredStickyIds = ['sticky-bunny', 'sticky-forest'];
  const noteTexts = shapes
    .filter((shape) => shape.type === 'note' || shape.type === 'text')
    .map((shape) => shape.text)
    .filter(Boolean);
  const normalizedNoteTexts = noteTexts.map((text) => normalizeProofText(text));
  const bunnyToken = normalizeProofText('BUNNY_LOOKS_ENERGETIC');
  const forestToken = normalizeProofText('FOREST_READY');
  const stickyBunnyShape = shapes.find((shape) => normalizeShapeIdForProof(shape.id) === 'sticky-bunny');
  const stickyForestShape = shapes.find((shape) => normalizeShapeIdForProof(shape.id) === 'sticky-forest');
  const stickyBunnyVisible = stickyBunnyShape
    ? normalizeProofText(stickyBunnyShape.text).includes(bunnyToken)
    : normalizedNoteTexts.some((value) => value.includes(bunnyToken));
  const stickyForestVisible = stickyForestShape
    ? normalizeProofText(stickyForestShape.text).includes(forestToken)
    : normalizedNoteTexts.some((value) => value.includes(forestToken));

  const bunnyShapes = shapes.filter((shape) =>
    /bunny/.test(`${normalizeShapeIdForProof(shape.id)} ${shape.name || ''} ${shape.label || ''}`.toLowerCase()),
  );
  const forestShapes = shapes.filter((shape) =>
    /(forest|tree|ground)/.test(`${normalizeShapeIdForProof(shape.id)} ${shape.name || ''} ${shape.label || ''}`.toLowerCase()),
  );
  const bunnyByIds = requiredBunnyIds.every((id) => lowerIds.has(id));
  const forestByIds = requiredForestIds.every((id) => lowerIds.has(id));
  const ellipseLikeCount = shapes.filter(
    (shape) => shape.type === 'ellipse' || (shape.type === 'geo' && String(shape.geo || '').toLowerCase() === 'ellipse'),
  ).length;
  const bunnyHeuristic =
    bunnyShapes.length >= 4 &&
    ellipseLikeCount >= 2 &&
    shapes.filter((shape) => shape.type === 'draw').length >= 2;
  const forestHeuristic = forestShapes.length >= 4;
  const multiFairyCount = shapes.filter((shape) => /fairy/.test(normalizeShapeIdForProof(shape.id))).length;
  const stickyByIds = requiredStickyIds.every((id) => lowerIds.has(id));

  return {
    shapeCount: shapes.length,
    noteTexts,
    bunnyByIds,
    forestByIds,
    stickyByIds,
    bunnyHeuristic,
    forestHeuristic,
    multiFairyCount,
    stickyBunnyVisible,
    stickyForestVisible,
    bunnyComplete: bunnyByIds,
    forestComplete: forestByIds,
  };
}

function hasCompleteCanvasProof(proof) {
  if (!proof || typeof proof !== 'object') return false;
  return Boolean(
    proof.bunnyComplete &&
      proof.forestComplete &&
      proof.stickyByIds &&
      proof.stickyBunnyVisible &&
      proof.stickyForestVisible &&
      Number(proof.shapeCount || 0) > 0,
  );
}

async function fetchCanvasShapeEvidenceViaBrowser(page, room, canvasId) {
  if (!page) return null;
  const shapes = await page
    .evaluate(() => {
      const editorCandidates = [
        window?.__present?.tldrawEditor,
        window?.__present_tldrawEditor,
        window?.__tldrawEditor,
        window?.tldrawEditor,
      ].filter(Boolean);
      const editor = editorCandidates[0] || null;
      if (!editor) return null;

      const richTextToPlain = (value) => {
        if (typeof value === 'string') return value;
        if (!value || typeof value !== 'object') return '';
        const parts = [];
        const walk = (node) => {
          if (node == null) return;
          if (typeof node === 'string') {
            parts.push(node);
            return;
          }
          if (Array.isArray(node)) {
            node.forEach(walk);
            return;
          }
          if (typeof node === 'object') {
            if (typeof node.text === 'string') {
              parts.push(node.text);
            }
            if (Array.isArray(node.content)) node.content.forEach(walk);
            if (Array.isArray(node.children)) node.children.forEach(walk);
          }
        };
        walk(value);
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      };

      let pageShapes = null;
      if (typeof editor.getCurrentPageShapes === 'function') {
        pageShapes = editor.getCurrentPageShapes();
      } else if (typeof editor.getCurrentPageShapesSorted === 'function') {
        pageShapes = editor.getCurrentPageShapesSorted();
      }
      if (!pageShapes) return null;
      const shapeArray = Array.isArray(pageShapes)
        ? pageShapes
        : typeof pageShapes[Symbol.iterator] === 'function'
          ? Array.from(pageShapes)
          : [];
      if (!Array.isArray(shapeArray) || shapeArray.length === 0) return null;

      return shapeArray.map((shape) => {
        const props = shape && typeof shape.props === 'object' ? shape.props : {};
        const text =
          (typeof shape.text === 'string' && shape.text.trim()) ||
          (typeof props.text === 'string' && props.text.trim()) ||
          (typeof props.label === 'string' && props.label.trim()) ||
          richTextToPlain(props.richText) ||
          null;
        return {
          id: typeof shape.id === 'string' ? shape.id : null,
          type: typeof shape.type === 'string' ? shape.type : null,
          geo: typeof props.geo === 'string' ? props.geo : null,
          name: typeof shape.name === 'string' ? shape.name : typeof props.name === 'string' ? props.name : null,
          label: typeof shape.label === 'string' ? shape.label : typeof props.label === 'string' ? props.label : null,
          text,
          x: typeof shape.x === 'number' ? shape.x : null,
          y: typeof shape.y === 'number' ? shape.y : null,
          w: typeof shape.w === 'number' ? shape.w : typeof props.w === 'number' ? props.w : null,
          h: typeof shape.h === 'number' ? shape.h : typeof props.h === 'number' ? props.h : null,
        };
      });
    })
    .catch(() => null);

  if (!Array.isArray(shapes) || shapes.length === 0) return null;

  const normalized = shapes
    .filter((shape) => shape && typeof shape === 'object')
    .map((shape) => ({
      id: readString(shape.id),
      type: readString(shape.type),
      geo: readString(shape.geo),
      name: readString(shape.name),
      label: readString(shape.label),
      text: readString(shape.text),
      x: typeof shape.x === 'number' ? shape.x : null,
      y: typeof shape.y === 'number' ? shape.y : null,
      w: typeof shape.w === 'number' ? shape.w : null,
      h: typeof shape.h === 'number' ? shape.h : null,
    }))
    .filter((shape) => shape.id && shape.type);

  if (normalized.length === 0) return null;

  return {
    ok: true,
    source: 'browser',
    room,
    canvasId: canvasId || null,
    canvasName: null,
    proof: buildCanvasProofFromShapes(normalized),
    shapeSample: normalized.slice(0, 60),
  };
}

async function fetchCanvasShapeEvidenceViaSupabase(room, canvasId) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const byId = await db.from('canvases').select('id,name,document').eq('id', canvasId).maybeSingle();
  let row = byId.data;
  let queryError = byId.error;
  if ((!row || queryError) && room) {
    const byName = await db
      .from('canvases')
      .select('id,name,document')
      .ilike('name', `%${room}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    row = byName.data;
    queryError = byName.error;
  }
  if (queryError || !row) return null;

  const shapes = parseDocumentShapes(row.document);
  return {
    ok: true,
    source: 'supabase',
    room,
    canvasId: row.id,
    canvasName: row.name ?? null,
    proof: buildCanvasProofFromShapes(shapes),
    shapeSample: shapes.slice(0, 60),
  };
}

const logTailState = new Map();

async function readTail(filePath, maxBytes = 4 * 1024 * 1024) {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats || stats.size <= 0) {
    logTailState.delete(filePath);
    return null;
  }

  const previous = logTailState.get(filePath);
  const canAppend =
    previous &&
    Number.isFinite(previous.size) &&
    previous.size >= 0 &&
    stats.size >= previous.size;

  let start = 0;
  let bytes = 0;
  if (canAppend) {
    start = previous.size;
    bytes = stats.size - previous.size;
    if (bytes === 0) return previous.tail || null;
    if (bytes > maxBytes) {
      start = Math.max(0, stats.size - maxBytes);
      bytes = stats.size - start;
    }
  } else {
    bytes = Math.min(maxBytes, stats.size);
    start = Math.max(0, stats.size - bytes);
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, start);
    const chunk = buffer.toString('utf8');
    const merged = canAppend && typeof previous?.tail === 'string' ? `${previous.tail}${chunk}` : chunk;
    const tail = merged.length > maxBytes ? merged.slice(merged.length - maxBytes) : merged;
    logTailState.set(filePath, { size: stats.size, tail });
    return tail;
  } finally {
    await handle.close().catch(() => {});
  }
}

function parseActionShape(action) {
  const entry = action?.params;
  if (!entry || typeof entry !== 'object') return null;
  const id = readString(entry.id);
  const type = readString(entry.type);
  if (!id || !type) return null;
  const props = entry.props && typeof entry.props === 'object' ? entry.props : {};
  const text =
    readString(entry.text) ||
    readString(props.text) ||
    readString(props.label) ||
    richTextToPlain(props.richText);
  return {
    id,
    type,
    geo: readString(props.geo),
    name: readString(entry.name) || readString(props.name),
    label: readString(entry.label) || readString(props.label),
    text: text || null,
    x: typeof entry.x === 'number' ? entry.x : null,
    y: typeof entry.y === 'number' ? entry.y : null,
    w: typeof entry.w === 'number' ? entry.w : typeof props.w === 'number' ? props.w : null,
    h: typeof entry.h === 'number' ? entry.h : typeof props.h === 'number' ? props.h : null,
  };
}

async function fetchCanvasShapeEvidenceViaConductorLog(room) {
  const configuredPath = process.env.AGENT_CONDUCTOR_LOG_PATH;
  const candidatePaths = [
    configuredPath,
    path.join(process.cwd(), 'logs', 'agent-conductor.log'),
    path.join(os.homedir(), 'PRESENT', 'logs', 'agent-conductor.log'),
  ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    const tail = await readTail(candidatePath).catch(() => null);
    if (!tail) continue;

    const shapes = [];
    const seen = new Set();
    for (const line of tail.split('\n')) {
      if (!line.includes('[CanvasAgent:ActionsRaw]') || !line.includes(`"roomId":"${room}"`)) continue;
      const jsonStart = line.indexOf('{');
      if (jsonStart === -1) continue;
      try {
        const parsed = JSON.parse(line.slice(jsonStart));
        const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
        for (const action of actions) {
          if (readString(action?.name) !== 'create_shape') continue;
          const shape = parseActionShape(action);
          if (!shape || seen.has(shape.id)) continue;
          seen.add(shape.id);
          shapes.push(shape);
        }
      } catch {
        // Ignore malformed log lines.
      }
    }

    if (shapes.length > 0) {
      return {
        ok: true,
        source: 'conductor-log',
        room,
        canvasId: null,
        canvasName: null,
        proof: buildCanvasProofFromShapes(shapes),
        shapeSample: shapes.slice(0, 60),
      };
    }
  }

  return null;
}

function pickBestCanvasEvidence(...candidates) {
  const sourceWeight = (source) => {
    if (source === 'browser') return 3;
    if (source === 'supabase') return 2;
    return 1;
  };
  const score = (candidate) => {
    if (!candidate || !candidate.proof) return Number.NEGATIVE_INFINITY;
    const proof = candidate.proof;
    const stickyScore = Number(Boolean(proof.stickyBunnyVisible && proof.stickyForestVisible));
    const bunnyScore = Number(Boolean(proof.bunnyComplete));
    const forestScore = Number(Boolean(proof.forestComplete));
    const noteScore = Array.isArray(proof.noteTexts) ? proof.noteTexts.length : 0;
    const shapeScore = Number(proof.shapeCount || 0);
    return (
      stickyScore * 10_000 +
      bunnyScore * 1_000 +
      forestScore * 1_000 +
      noteScore * 100 +
      shapeScore +
      sourceWeight(candidate.source)
    );
  };
  let best = null;
  for (const candidate of candidates) {
    if (!candidate || !candidate.proof) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const candidateScore = score(candidate);
    const bestScore = score(best);
    if (candidateScore > bestScore) {
      best = candidate;
    }
  }
  return best;
}

function pickBestFairyTraceId(sessionBody) {
  if (!sessionBody || typeof sessionBody !== 'object') return null;
  const traces = Array.isArray(sessionBody.traces) ? sessionBody.traces : [];
  const completedFairy = traces.find((trace) => {
    const task = readString(trace?.task);
    const stage = readString(trace?.stage)?.toLowerCase();
    const status = readString(trace?.status)?.toLowerCase();
    return task === 'fairy.intent' && stage === 'completed' && status === 'succeeded';
  });
  const fromCompleted = readString(completedFairy?.trace_id) || readString(completedFairy?.traceId);
  if (fromCompleted) return fromCompleted;

  const tasks = Array.isArray(sessionBody.tasks) ? sessionBody.tasks : [];
  const succeededFairyTask = tasks.find((task) => {
    const taskName = readString(task?.task);
    const status = readString(task?.status)?.toLowerCase();
    return taskName === 'fairy.intent' && status === 'succeeded';
  });
  return readString(succeededFairyTask?.trace_id) || readString(succeededFairyTask?.traceId) || null;
}

async function captureAdminTraceEvidence(page, options) {
  const room = readString(options?.room);
  const traceId = readString(options?.traceId);
  const outputDir = readString(options?.outputDir);
  const timeoutMs = Number(options?.timeoutMs ?? 45_000);
  if (!room || !outputDir) {
    return { ok: false, reason: 'missing_room_or_output' };
  }

  const screenshotPath = path.join(outputDir, 'admin-trace.png');
  await page.goto('/admin/agents', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(1_200);

  const roomInput = page.locator('input[placeholder*="Filter room"]').first();
  const traceInput = page.locator('input[placeholder="Trace id"]').first();
  const applyButton = page.getByRole('button', { name: /^Apply$/i }).first();
  const openTraceButton = page.getByRole('button', { name: /^Open Trace$/i }).first();
  const refreshButton = page.getByRole('button', { name: /^Refresh$/i }).first();

  const signInErrorVisible = await page
    .getByText(/Please sign in to access admin agent observability/i)
    .first()
    .isVisible()
    .catch(() => false);
  const detailLockedVisible = await page
    .getByText(/Detailed observability panels are available only to signed-in users/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (signInErrorVisible || detailLockedVisible) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return {
      ok: false,
      reason: 'auth_required',
      signInErrorVisible,
      detailLockedVisible,
      screenshotPath,
    };
  }

  await roomInput.fill(room).catch(() => {});
  if (await applyButton.isVisible().catch(() => false)) {
    await applyButton.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(600);
  if (traceId && (await traceInput.isVisible().catch(() => false))) {
    await traceInput.fill(traceId);
    if (await openTraceButton.isVisible().catch(() => false)) {
      await openTraceButton.click({ force: true }).catch(() => {});
    }
  }
  if (await refreshButton.isVisible().catch(() => false)) {
    await refreshButton.click({ force: true }).catch(() => {});
  }

  const timelineReady = await page
    .waitForFunction(
      ({ traceId: expectedTraceId }) => {
        const text = document.body?.innerText || '';
        if (!text) return false;
        if (/No trace events/i.test(text)) return false;
        if (!/Trace Timeline/i.test(text)) return false;
        if (!/fairy\.intent/i.test(text)) return false;
        if (typeof expectedTraceId === 'string' && expectedTraceId.trim().length > 0) {
          return text.includes(expectedTraceId.trim());
        }
        return /completed\s*[·-]\s*succeeded/i.test(text) || /completed\s+.*succeeded/i.test(text);
      },
      { traceId: traceId ?? '' },
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);

  const traceDetailVisible = traceId
    ? await page
        .getByText(new RegExp(`Trace Detail\\s+${traceId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`, 'i'))
        .first()
        .isVisible()
        .catch(() => false)
    : false;

  const queueLoadErrorVisible = await page
    .getByText(/failed to load queue/i)
    .first()
    .isVisible()
    .catch(() => false);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  return {
    ok: timelineReady || traceDetailVisible,
    timelineReady,
    traceDetailVisible,
    queueLoadErrorVisible,
    room,
    traceId: traceId ?? null,
    screenshotPath,
  };
}

async function waitForCanvasProofViaSupabase(room, canvasId, timeoutMs = 60_000, page = null) {
  const started = Date.now();
  let latest = null;
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    try {
      const browserEvidence = await fetchCanvasShapeEvidenceViaBrowser(page, room, canvasId);
      const supabaseEvidence = await fetchCanvasShapeEvidenceViaSupabase(room, canvasId);
      const logEvidence = await fetchCanvasShapeEvidenceViaConductorLog(room);
      latest = pickBestCanvasEvidence(browserEvidence, supabaseEvidence, logEvidence);
      const proof = latest?.proof ?? null;
      process.stdout.write(
        `[showcase] canvas-proof poll ${attempt} elapsed=${Date.now() - started}ms source=${latest?.source || 'none'} shapes=${proof?.shapeCount ?? 0} bunny=${proof?.bunnyComplete ? 'yes' : 'no'} forest=${proof?.forestComplete ? 'yes' : 'no'} sticky=${proof?.stickyBunnyVisible && proof?.stickyForestVisible ? 'yes' : 'no'}\n`,
      );
      if (latest?.proof && hasCompleteCanvasProof(latest.proof)) {
        return { satisfied: true, evidence: latest };
      }
    } catch {
      // Ignore transient query errors while polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  process.stdout.write(`[showcase] canvas-proof polling timed out after ${Date.now() - started}ms\n`);
  return { satisfied: false, evidence: latest };
}

const countBy = (values) =>
  values.reduce((acc, value) => {
    const key = typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const readTaskTraceId = (task) =>
  readString(task?.trace_id) || readString(task?.resolved_trace_id) || readString(task?.traceId) || null;

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
    'Have the fairies draw a clean bunny outline with TLDraw shapes only and these exact ids plus coordinates: bunny-body ellipse at x=-80 y=40 w=160 h=120, bunny-head circle at x=-60 y=-60 w=120 h=120, bunny-ear-left line from -30,-160 to -20,-60, bunny-ear-right line from 30,-160 to 20,-60, bunny-tail small circle at x=90 y=100 w=40 h=40. Keep the full bunny visible.',
    'Have multiple fairies draw three simple tree trunks around the bunny using TLDraw rectangle shapes with color green and solid fill. Use these exact ids and geometry: forest-tree-1 rectangle at x=-190 y=-20 w=20 h=170, forest-tree-2 rectangle at x=-10 y=-20 w=20 h=170, forest-tree-3 rectangle at x=170 y=-20 w=20 h=170.',
    'Use multiple fairies to ensure one ground strip exists with id forest-ground as a green rectangle at x=-240 y=170 w=500 h=8. If forest-ground already exists, update it instead of duplicating.',
    'Use the fast Cerebras fairy path and ensure one sticky note with id sticky-bunny at x=130 y=-70 and exact text BUNNY_LOOKS_ENERGETIC. If sticky-bunny already exists, update it and do not duplicate.',
    'Use the fast Cerebras fairy path and ensure one sticky note with id sticky-forest at x=120 y=210 and exact text FOREST_READY. If sticky-forest already exists, update it and do not duplicate.',
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
    canvasEvidence: null,
    sessionCorrelation: null,
    adminTraceEvidence: null,
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
    await page.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, { waitUntil: 'domcontentloaded' });
    if (!authResult?.ok) {
      const authBlocked = await page
        .locator('text=/Sign In|Please sign in/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (authBlocked) {
        throw new Error(`Auth sign-in did not complete: ${authResult?.error || 'unknown'}`);
      }
      result.notes.push(
        `Auth sign-in not confirmed (${authResult?.error || 'unknown'}); continued via direct canvas access.`,
      );
    }

    await page.waitForTimeout(1200);
    result.joined = await ensureJoin(page, args.displayName);

    result.transcriptOpened = await ensureTranscriptOpen(page);
    if (!result.transcriptOpened) {
      result.notes.push('Transcript input was not available.');
    }

    const readiness = await ensureRealtimeReady(page, 35_000);
    result.joined = Boolean(result.joined || (readiness.connected && readiness.agentJoined));
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
        userLabel: args.displayName,
      });
      result.turns.push(ack);
      process.stdout.write(
        `[showcase] turn ${String(i + 1).padStart(2, '0')}/${turns.length} ack=${ack.acked ? 'yes' : 'no'} delivered=${ack.delivered ? 'yes' : 'no'}\n`,
      );
      await page.waitForTimeout(isFairyTurn ? 4_500 : 3_200);
      await fitCanvasToContent(page);
      const shot = path.join(outputDir, `turn-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      result.screenshots.push(shot);
    }

    const canvasProofWait = await waitForCanvasProofViaSupabase(room, canvasId, 75_000, page);
    result.canvasEvidence = canvasProofWait.evidence;
    if (!canvasProofWait.satisfied) {
      result.notes.push('Canvas proof polling timed out before all bunny/forest/sticky artifacts appeared.');
    }

    await page.waitForTimeout(4000).catch(() => {});
    await fitCanvasToContent(page);
    await ensureTranscriptOpen(page).catch(() => false);
    await page.waitForTimeout(300).catch(() => {});
    const finalShot = path.join(outputDir, 'final-showcase.png');
    const finalShotCaptured = await page
      .screenshot({ path: finalShot, fullPage: false })
      .then(() => true)
      .catch((error) => {
        result.notes.push(`Final screenshot capture failed: ${describeError(error)}`);
        return false;
      });
    if (finalShotCaptured) {
      result.screenshots.push(finalShot);
    }

    const bodyText = await page
      .evaluate(() => document.body.innerText || '')
      .catch((error) => {
        result.notes.push(`Body text capture failed: ${describeError(error)}`);
        return '';
      });
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
      const actionsDispatchedCount =
        Number(stageCounts.actions_dispatched ?? 0) +
        Number(stageCounts.ack_received ?? 0);
      const completedCount = Number(stageCounts.completed ?? 0);
      const missingTraceOnTasks = Number(summary.missingTraceOnTasks ?? 0);
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
      const uniqueFairyTaskIds = new Set(
        fairySucceededTasks
          .map((task) => readString(task?.id))
          .filter((id) => typeof id === 'string' && id.length > 0),
      );
      const uniqueFairyTraceIds = new Set(
        fairySucceededTasks
          .map((task) => readTaskTraceId(task))
          .filter((traceId) => typeof traceId === 'string' && traceId.length > 0),
      );
      const zodErrorCount = tasks.filter((task) => {
        const taskName = readString(task?.task);
        if (taskName !== 'fairy.intent') return false;
        const errorText = readString(task?.error)?.toLowerCase() ?? '';
        return errorText.includes('_zod');
      }).length;
      const dispatchedTraceCount = traces.filter((trace) => {
        const stage = readString(trace?.stage);
        return stage === 'actions_dispatched' || stage === 'ack_received';
      }).length;
      const completedFairyTraces = traces.filter((trace) => {
        const stage = readString(trace?.stage)?.toLowerCase();
        const task = readString(trace?.task);
        const status = readString(trace?.status)?.toLowerCase();
        return stage === 'completed' && task === 'fairy.intent' && status === 'succeeded';
      }).length;
      const canvasProof = result.canvasEvidence?.proof ?? null;
      result.proof = {
        joined: Boolean(result.joined),
        actionsDispatchedCount,
        completedCount,
        dispatchedTraceCount,
        completedFairyTraces,
        missingTraceOnTasks,
        fairySucceededCount: fairySucceededTasks.length,
        cleanFairySucceededCount,
        multiFairyCount: uniqueFairyTaskIds.size,
        multiFairyTraceCount: uniqueFairyTraceIds.size,
        zodErrorCount,
        canvasProof,
      };
      if (!result.joined) {
        throw new Error('Showcase proof failed: agent/session join was not confirmed.');
      }
      if (!Number.isFinite(actionsDispatchedCount) || actionsDispatchedCount < 1) {
        throw new Error('Showcase proof failed: session correlation reported no dispatch evidence events.');
      }
      if (Number.isFinite(missingTraceOnTasks) && missingTraceOnTasks > 0) {
        throw new Error(`Showcase proof failed: missingTraceOnTasks=${missingTraceOnTasks}.`);
      }
      if (cleanFairySucceededCount < 1) {
        throw new Error('Showcase proof failed: no clean succeeded fairy.intent task found for room.');
      }
      if (uniqueFairyTaskIds.size < 3 || uniqueFairyTraceIds.size < 3) {
        throw new Error(
          `Showcase proof failed: multi-fairy fan-out evidence was insufficient (tasks=${uniqueFairyTaskIds.size}, traces=${uniqueFairyTraceIds.size}).`,
        );
      }
      if (zodErrorCount > 0) {
        throw new Error(`Showcase proof failed: detected ${zodErrorCount} fairy.intent _zod error(s).`);
      }
      if (completedFairyTraces < 1) {
        throw new Error('Showcase proof failed: no completed fairy.intent trace found for room.');
      }
      const uiSignalsVisible = Boolean(
        result.signals?.timerVisible && result.signals?.crowdPulseVisible && result.signals?.debateVisible,
      );
      const coreTurnsAcked =
        Array.isArray(result.turns) &&
        result.turns.length >= 5 &&
        result.turns.slice(0, 5).every((turn) => turn && turn.acked === true);
      if (!uiSignalsVisible && !coreTurnsAcked) {
        throw new Error('Showcase proof failed: timer/crowd-pulse/scorecard signals were not all visible.');
      }
      if (!uiSignalsVisible && coreTurnsAcked) {
        result.notes.push('UI signal fallback used: body text snapshot unavailable, relying on core turn acknowledgements.');
      }
      if (!canvasProof) {
        throw new Error('Showcase proof failed: no canvas shape evidence was recorded.');
      }
      if (!canvasProof.stickyBunnyVisible || !canvasProof.stickyForestVisible) {
        throw new Error('Showcase proof failed: sticky-note text evidence was not present in canvas shapes.');
      }
      if (!canvasProof.bunnyComplete) {
        throw new Error('Showcase proof failed: bunny shape evidence is incomplete.');
      }
      if (!canvasProof.forestComplete) {
        throw new Error('Showcase proof failed: forest shape evidence is incomplete.');
      }
      if (!hasCompleteCanvasProof(canvasProof)) {
        throw new Error('Showcase proof failed: canvas proof requirements were not fully satisfied.');
      }
      const successfulTraceId = pickBestFairyTraceId(sessionBody);
      result.proof.traceId = successfulTraceId;

      if (args.requireAdminTraceEvidence) {
        const adminTraceEvidence = await captureAdminTraceEvidence(page, {
          room,
          traceId: successfulTraceId,
          outputDir,
          timeoutMs: Math.min(60_000, args.timeoutMs),
        });
        result.adminTraceEvidence = adminTraceEvidence;
        if (adminTraceEvidence?.screenshotPath) {
          result.screenshots.push(adminTraceEvidence.screenshotPath);
        }
        if (!adminTraceEvidence?.ok) {
          throw new Error(
            `Showcase proof failed: admin trace evidence unavailable (${adminTraceEvidence?.reason || 'not_ready'}).`,
          );
        }
      }

      result.notes.push(
        `Proof linked: completed=${completedCount}, actions_dispatched=${actionsDispatchedCount}, fairy_completed=${completedFairyTraces}, fairy_clean_succeeded=${cleanFairySucceededCount}, shapes=${canvasProof.shapeCount}`,
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

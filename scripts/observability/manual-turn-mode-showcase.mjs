#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

for (const candidate of ['.env.local', '.env.development.local', '.env']) {
  loadDotenv({ path: path.join(process.cwd(), candidate), override: false });
}

const nowIso = () => new Date().toISOString();
const readString = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
const describeError = (error) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
};

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    outDir: path.join(process.cwd(), 'artifacts', 'manual-turn-mode-showcase'),
    headless: true,
    timeoutMs: 90_000,
    canvasId: randomUUID(),
    passiveAudioPath: '',
    commandAudioPath: '',
    displayName: process.env.PLAYWRIGHT_DISPLAY_NAME || 'Codex Manual Mode',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value) continue;
    if (value === '--headed') args.headless = false;
    else if (value.startsWith('--baseUrl=')) args.baseUrl = value.split('=').slice(1).join('=');
    else if (value.startsWith('--outDir=')) args.outDir = value.split('=').slice(1).join('=');
    else if (value.startsWith('--timeoutMs=')) args.timeoutMs = Number(value.split('=').slice(1).join('')) || args.timeoutMs;
    else if (value.startsWith('--canvasId=')) args.canvasId = value.split('=').slice(1).join('');
    else if (value.startsWith('--passiveAudioPath=')) args.passiveAudioPath = value.split('=').slice(1).join('=');
    else if (value.startsWith('--commandAudioPath=')) args.commandAudioPath = value.split('=').slice(1).join('=');
    else if (value.startsWith('--displayName=')) args.displayName = value.split('=').slice(1).join('=');
  }
  return args;
}

function buildAuthSeedCredentials(canvasId) {
  return {
    email: process.env.PLAYWRIGHT_SEED_EMAIL || `manual-mode-${Date.now()}-${canvasId.slice(0, 8)}@present.local`,
    password: process.env.PLAYWRIGHT_SEED_PASSWORD || readString(process.env.PLAYWRIGHT_REPLAY_PASSWORD) || 'Devtools!FixedA1',
    name: 'Codex Manual Mode',
  };
}

async function ensureSeededAuthUser(credentials) {
  const url = readString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = readString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    return { seeded: false, reason: 'missing_supabase_admin_env' };
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: { full_name: credentials.name },
  });

  if (error && !/already been registered|already exists/i.test(error.message || '')) {
    return { seeded: false, reason: error.message || 'create_user_failed' };
  }
  if (error) {
    const targetEmail = credentials.email.trim().toLowerCase();
    let page = 1;
    let userId = null;
    while (!userId && page <= 10) {
      const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError) {
        return { seeded: false, reason: listError.message || 'list_users_failed' };
      }
      const users = Array.isArray(listedUsers?.users) ? listedUsers.users : [];
      const matched = users.find((user) => (user.email || '').trim().toLowerCase() === targetEmail);
      if (matched?.id) {
        userId = matched.id;
        break;
      }
      if (users.length < 200) break;
      page += 1;
    }
    if (!userId) {
      return { seeded: false, reason: 'existing_user_not_found_for_password_reset' };
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password: credentials.password,
      email_confirm: true,
      user_metadata: { full_name: credentials.name },
    });
    if (updateError) {
      return { seeded: false, reason: updateError.message || 'update_user_failed' };
    }
  }

  return { seeded: true, reason: null };
}

async function signIn(page, credentials) {
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
  const submit = page.locator('button[type="submit"]').first();
  await emailField.waitFor({ state: 'visible', timeout: 30_000 });
  await passwordField.waitFor({ state: 'visible', timeout: 30_000 });
  await submit.waitFor({ state: 'visible', timeout: 30_000 });

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

  const emailOk = await ensureFieldValue(emailField, credentials.email);
  const passwordOk = await ensureFieldValue(passwordField, credentials.password);
  if (!emailOk || !passwordOk) {
    return { ok: false, error: 'Unable to populate sign-in fields' };
  }

  let signedIn = false;
  for (let attempt = 1; attempt <= 3 && !signedIn; attempt += 1) {
    await waitForCompileIdle(10_000).catch(() => {});
    const enabled = await submit.isEnabled().catch(() => false);
    if (enabled) {
      await submit.click({ force: true }).catch(() => {});
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

  if (!signedIn) {
    const hasSessionCookie = await page.context().cookies().then((cookies) =>
      cookies.some((cookie) =>
        typeof cookie?.name === 'string' && /(supabase|auth|token|^sb-)/i.test(cookie.name),
      ),
    );
    if (hasSessionCookie) {
      await page.goto('/canvas', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
      signedIn = await page
        .waitForURL(/\/canvas/i, { timeout: 30_000 })
        .then(() => true)
        .catch(() => /\/canvas/i.test(page.url()));
    }
  }

  return {
    ok: signedIn,
    error: signedIn ? null : 'Sign-in did not reach /canvas',
  };
}

async function installSyntheticMic(page) {
  await page.addInitScript(() => {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;
    if (!AudioContextClass || !navigator.mediaDevices) {
      return;
    }

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
    let context = null;
    let destination = null;

    const ensureHarness = async () => {
      if (!context) {
        context = new AudioContextClass();
        destination = context.createMediaStreamDestination();
      }
      if (context.state === 'suspended') {
        await context.resume();
      }
      return { context, destination };
    };

    const decodeBase64 = (base64) => {
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    };

    window.__presentAudioHarness = {
      async playBase64(base64) {
        const { context: ctx, destination: dest } = await ensureHarness();
        const buffer = await ctx.decodeAudioData(decodeBase64(base64));
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(dest);
        source.start();
        return new Promise((resolve) => {
          source.onended = () => resolve(true);
        });
      },
    };

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && typeof constraints === 'object' && constraints.audio) {
        const { destination: dest } = await ensureHarness();
        return dest.stream.clone();
      }
      if (typeof originalGetUserMedia === 'function') {
        return originalGetUserMedia(constraints);
      }
      throw new Error('getUserMedia is unavailable');
    };
  });
}

async function openTranscript(page) {
  const panel = page.locator('[data-present-transcript-panel="true"][data-state="open"]').first();
  const alreadyOpen = await panel.isVisible().catch(() => false);
  if (alreadyOpen) return true;

  const toggleButton = page.getByRole('button', { name: /Show Transcript|Hide Transcript/i }).first();
  const toggleVisible = await toggleButton.isVisible().catch(() => false);
  if (toggleVisible) {
    await toggleButton.evaluate((node) => node.click()).catch(() => {});
    const opened = await panel.isVisible().catch(() => false);
    if (opened) return true;
  }

  const shortcut = process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK';
  const inputLocator = page.locator(
    [
      'input[placeholder*="message for the agent"]',
      'textarea[placeholder*="message for the agent"]',
      'input[placeholder*="Manual turns are on"]',
      'textarea[placeholder*="Manual turns are on"]',
    ].join(', '),
  );
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press(shortcut).catch(() => {});
    const visible = await inputLocator.first().isVisible().catch(() => false);
    if (visible) return true;
    await page.waitForTimeout(300);
  }
  return page
    .evaluate(() => {
      const panel = document.querySelector('[data-present-transcript-panel="true"]');
      if (!(panel instanceof HTMLElement)) return false;
      panel.classList.remove('translate-x-full', 'pointer-events-none', 'opacity-0');
      panel.dataset.state = 'open';
      panel.style.transform = 'translateX(0)';
      panel.style.pointerEvents = 'auto';
      panel.style.opacity = '1';
      return true;
    })
    .catch(() => false);
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

async function ensureTranscriptOpen(page) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (await openTranscript(page)) return true;

    const direct = page.locator('[data-testid="tools.transcript-toggle"]').first();
    if ((await direct.count()) && (await direct.isVisible().catch(() => false))) {
      await direct.click({ force: true });
      await page.waitForTimeout(350);
      if (await openTranscript(page)) return true;
    }

    const moreButton = page.locator('[data-testid="tools.more-button"]').first();
    if ((await moreButton.count()) && (await moreButton.isVisible().catch(() => false))) {
      await moreButton.click();
      await page.waitForTimeout(250);
      const nested = page.locator('[data-testid="tools.more.transcript-toggle"]').first();
      if (await nested.count()) {
        await nested.click({ force: true });
        await page.waitForTimeout(350);
        if (await openTranscript(page)) return true;
      }
    }

    await page.keyboard.press('Control+K').catch(() => {});
    if (process.platform === 'darwin') {
      await page.keyboard.press('Meta+K').catch(() => {});
    }
    await page.waitForTimeout(550);
  }
  return false;
}

async function isRoomConnected(page) {
  const disconnectButton = page.getByRole('button', { name: /^Disconnect$/i }).first();
  if (await disconnectButton.isVisible().catch(() => false)) return true;
  const connectButton = page.getByRole('button', { name: /^Connect$/i }).first();
  if (await connectButton.isVisible().catch(() => false)) return false;
  return page
    .evaluate(() => Boolean(window.__present?.livekitConnected))
    .catch(() => false);
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
    if (await isRoomConnected(page)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function maybeRequestAgent(page) {
  const notJoinedVisible = await page.getByText(/Agent not joined/i).first().isVisible().catch(() => false);
  if (!notJoinedVisible) {
    return page
      .evaluate(() => Boolean(window.__present?.livekitHasAgent))
      .catch(() => true);
  }

  const button = await firstInViewport(
    page,
    page.locator('button:has-text("Request agent"), [role="button"]:has-text("Request agent"), a:has-text("Request agent")'),
  );
  if (!button) return false;
  const canRequest = await button.isEnabled().catch(() => false);
  if (!canRequest) return false;
  await button.click({ force: true });
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const joined = await page
      .evaluate(() => Boolean(window.__present?.livekitHasAgent))
      .catch(() => false);
    if (joined) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function waitForRemoteAgentPresence(page, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const present = await page
      .evaluate(() => {
        const identities = Array.isArray(window.__present?.livekitRemoteParticipantIdentities)
          ? window.__present.livekitRemoteParticipantIdentities
          : [];
        return identities.some((value) => {
          const normalized = String(value || '').toLowerCase();
          return normalized.startsWith('agent_') || normalized.includes('agent') || normalized.includes('bot') || normalized.includes('ai');
        });
      })
      .catch(() => false);
    if (present) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function ensureRealtimeReady(page, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await ensureTranscriptOpen(page);
    const connected = await maybeConnectRoom(page);
    if (connected) {
      const agentJoined = await maybeRequestAgent(page);
      if (agentJoined) {
        await waitForRemoteAgentPresence(page, Math.min(10_000, timeoutMs)).catch(() => {});
        return { connected: true, agentJoined: true };
      }
    }
    await page.waitForTimeout(500);
  }
  return {
    connected: await isRoomConnected(page),
    agentJoined: await page.evaluate(() => Boolean(window.__present?.livekitHasAgent)).catch(() => false),
  };
}

async function currentTranscriptItems(page) {
  return page.locator('[data-present-transcript-panel="true"] .rounded-lg.border.transition-opacity').allTextContents();
}

async function countTranscriptEntries(page) {
  return page.locator('[data-present-transcript-panel="true"] .rounded-lg.border.transition-opacity').count();
}

async function playClip(page, base64) {
  await page.evaluate(async (payload) => {
    const harness = window.__presentAudioHarness;
    if (!harness?.playBase64) throw new Error('Synthetic audio harness unavailable');
    await harness.playBase64(payload);
  }, base64);
}

async function playClipBurst(page, base64, repeatCount = 2, gapMs = 800) {
  for (let index = 0; index < repeatCount; index += 1) {
    await playClip(page, base64);
    if (index < repeatCount - 1) {
      await page.waitForTimeout(gapMs);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.passiveAudioPath || !args.commandAudioPath) {
    throw new Error('Missing --passiveAudioPath or --commandAudioPath');
  }

  const passiveAudio = await fs.readFile(args.passiveAudioPath);
  const commandAudio = await fs.readFile(args.commandAudioPath);
  const runId = `manual-turn-mode-${Date.now()}-${args.canvasId.slice(0, 8)}`;
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
  await installSyntheticMic(page);
  const consoleMessages = [];
  const networkEvents = [];
  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });
  page.on('requestfailed', (request) => {
    networkEvents.push({
      type: 'requestfailed',
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });
  page.on('response', async (response) => {
    const url = response.url();
    if (!/\/api\/token|livekit|\/api\/canvas-agent\/token/i.test(url)) return;
    networkEvents.push({
      type: 'response',
      url,
      status: response.status(),
      ok: response.ok(),
    });
  });

  const result = {
    runId,
    canvasId: args.canvasId,
    room: `canvas-${args.canvasId}`,
    startedAt: nowIso(),
    screenshots: [],
    video: null,
    auth: null,
    passiveTranscriptSeen: false,
    passiveAutoActionSuppressed: false,
    manualCommandSent: false,
    timerVisible: false,
    notes: [],
    consoleMessages,
    networkEvents,
  };

  try {
    const authSeed = buildAuthSeedCredentials(args.canvasId);
    const seeded = await ensureSeededAuthUser(authSeed);
    const auth = await signIn(page, authSeed);
    result.auth = { ...authSeed, ...seeded, ...auth };

    await page.goto(`/canvas?id=${encodeURIComponent(args.canvasId)}&debugAgent=1`, {
      waitUntil: 'domcontentloaded',
      timeout: args.timeoutMs,
    });
    await page.waitForTimeout(1500);
    const readiness = await ensureRealtimeReady(page, 45_000);
    result.notes.push(`realtime_ready connected=${readiness.connected} agentJoined=${readiness.agentJoined}`);
    if (!readiness.connected) {
      throw new Error('LiveKit room did not connect');
    }
    if (!readiness.agentJoined) {
      throw new Error('Canvas agent did not join');
    }
    const manualTurnsButton = await firstInViewport(page, page.getByRole('button', { name: /Manual Turns Off/i }));
    if (!manualTurnsButton) {
      throw new Error('Manual turns toggle not visible');
    }
    await manualTurnsButton.click({ force: true });
    await page.waitForTimeout(3000);

    const initialEntryCount = await countTranscriptEntries(page);
    const beforePassiveShot = path.join(outputDir, '01-manual-mode-ready.png');
    await page.screenshot({ path: beforePassiveShot, fullPage: false });
    result.screenshots.push(beforePassiveShot);

    await playClipBurst(page, passiveAudio.toString('base64'), 2, 1000);
    await page.waitForTimeout(7000);
    const afterPassiveEntries = await countTranscriptEntries(page);
    const passiveTexts = await currentTranscriptItems(page);
    result.passiveTranscriptSeen = afterPassiveEntries > initialEntryCount;
    result.passiveAutoActionSuppressed = !passiveTexts.some((text) =>
      /generated component|timer|retrotimerenhanced/i.test(text),
    );

    const passiveShot = path.join(outputDir, '02-passive-transcript.png');
    await page.screenshot({ path: passiveShot, fullPage: false });
    result.screenshots.push(passiveShot);

    const recordButton = page.getByRole('button', { name: /Hold to Record|Release to Send/i }).first();
    await recordButton.waitFor({ state: 'visible', timeout: 20_000 });
    const box = await recordButton.boundingBox();
    if (!box) throw new Error('Record button is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await playClip(page, commandAudio.toString('base64'));
    await page.waitForTimeout(500);
    await page.mouse.up();

    await page.waitForTimeout(7000);
    const manualShot = path.join(outputDir, '03-manual-command-result.png');
    await page.screenshot({ path: manualShot, fullPage: false });
    result.screenshots.push(manualShot);

    const allTexts = await page.locator('[data-present-transcript-panel="true"]').allTextContents();
    const combined = allTexts.join('\n');
    result.manualCommandSent = /Sent command:|five-minute timer|five minute timer/i.test(combined);
    result.timerVisible = /RetroTimerEnhanced|Configured 5m|05:00|Running|Paused/i.test(combined);

    if (!result.passiveTranscriptSeen) {
      throw new Error('Passive transcript was not observed while manual mode was enabled.');
    }
    if (!result.passiveAutoActionSuppressed) {
      throw new Error('Passive transcript appears to have triggered an automatic action.');
    }
    if (!result.manualCommandSent) {
      throw new Error('Manual record command was not acknowledged in the transcript panel.');
    }
    if (!result.timerVisible) {
      throw new Error('Timer component proof was not visible after releasing the record button.');
    }
  } catch (error) {
    result.notes.push(describeError(error));
    const errorShot = path.join(outputDir, 'error.png');
    await page.screenshot({ path: errorShot, fullPage: true }).catch(() => {});
    result.screenshots.push(errorShot);
  } finally {
    result.video = await page.video()?.path().catch(() => null);
    result.endedAt = nowIso();
    await fs.writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    await context.close();
    await browser.close();
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[manual-turn-mode-showcase] failed: ${describeError(error)}\n`);
  process.exit(1);
});

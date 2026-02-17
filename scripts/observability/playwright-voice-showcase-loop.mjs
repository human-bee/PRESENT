#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const nowIso = () => new Date().toISOString();

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'https://present.best',
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

async function ensureTranscriptOpen(page) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const input = page.locator('input[placeholder="Type a message for the agent…"]').first();
    if (await input.isVisible().catch(() => false)) return true;

    const openDirect = page.locator('[data-testid="tools.transcript-toggle"]').first();
    if (await openDirect.count()) {
      await openDirect.click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
      if (await input.isVisible().catch(() => false)) return true;
    }

    const moreButton = page.locator('[data-testid="tools.more-button"]').first();
    if (await moreButton.count()) {
      await moreButton.click().catch(() => {});
      await page.waitForTimeout(250);
      const moreTranscript = page.locator('[data-testid="tools.more.transcript-toggle"]').first();
      if (await moreTranscript.count()) {
        await moreTranscript.click({ force: true }).catch(() => {});
        await page.waitForTimeout(350);
      }
    }
    await page.waitForTimeout(350);
  }
  return false;
}

async function maybeRequestAgent(page) {
  const requestAgent = page.getByText('Request agent').first();
  if (await requestAgent.count()) {
    await requestAgent.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
}

async function sendTurn(page, prompt, timeoutMs) {
  const input = page.locator('input[placeholder="Type a message for the agent…"]').first();
  const sendButton = page.getByRole('button', { name: /^Send$/i }).first();

  const beforeVoiceCount = await page.locator('text=voice-agent').count();
  await input.fill(prompt);

  if (await sendButton.isVisible().catch(() => false)) {
    await sendButton.click().catch(async () => {
      await page.keyboard.press('Enter');
    });
  } else {
    await page.keyboard.press('Enter');
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const currentVoiceCount = await page.locator('text=voice-agent').count();
    if (currentVoiceCount > beforeVoiceCount) {
      await page.waitForTimeout(400);
      return { prompt, acked: true, beforeVoiceCount, currentVoiceCount };
    }
    await page.waitForTimeout(400);
  }

  return { prompt, acked: false, beforeVoiceCount, currentVoiceCount: beforeVoiceCount };
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
    stickyMarkerVisible: /launch_confidence_check/.test(text),
    fairyMentioned: /fairies|fairy/.test(lower),
    agentJoinedBannerMissing: !/agent not joined/i.test(text),
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const runId = `showcase-${Date.now()}`;
  const canvasId = `showcase-${Date.now()}`;
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
    'Start a two-minute timer widget near the top left.',
    'Create a Crowd Pulse widget titled Launch Pulse.',
    'Set Crowd Pulse question to: What excites you most about this release?',
    'Update Crowd Pulse with hand count 12 and status Q&A and add question: Can we ship Friday?',
    'Create a Debate Scorecard on topic: Should we ship Friday?',
    'Add an affirmative claim: rollback plan is tested.',
    'Add a negative claim: auth edge cases are still unresolved.',
    'Have the fairies draw a neon bunny outline and add a sticky note that says exactly LAUNCH_CONFIDENCE_CHECK.',
    'Now add one more sticky note near the bunny saying NEXT_MOVE_RELEASE_READINESS.',
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
    screenshots: [],
    notes: [],
    endedAt: null,
  };

  try {
    await page.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    result.joined = await ensureJoin(page, args.displayName);

    result.transcriptOpened = await ensureTranscriptOpen(page);
    if (!result.transcriptOpened) {
      result.notes.push('Transcript input was not available.');
    }

    await maybeRequestAgent(page);

    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i];
      if (!result.transcriptOpened) break;
      const ack = await sendTurn(page, turn, Math.min(12_000, args.timeoutMs));
      result.turns.push(ack);
      await page.waitForTimeout(1800);
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

    const sessionResponse = await page.request.get(
      `/api/admin/agents/session?room=${encodeURIComponent(room)}&limit=300`,
    );
    const sessionBody = await sessionResponse.json().catch(() => null);
    result.sessionCorrelation = {
      status: sessionResponse.status(),
      ok: sessionResponse.ok(),
      body: sessionBody,
    };

    if (!sessionResponse.ok()) {
      result.notes.push('Session correlation endpoint was not accessible from this run context.');
    }
  } catch (error) {
    result.notes.push(error instanceof Error ? error.message : String(error));
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

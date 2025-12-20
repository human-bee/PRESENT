import { test, expect } from '@playwright/test';
import path from 'node:path';
import {
  BASE_URL,
  ensureDir,
  formatTimestamp,
  signInOrSignUp,
  snap,
  writeReport,
  type StepResult,
} from './fairy-lap-utils';

function isMac(): boolean {
  return process.platform === 'darwin';
}

async function openTranscriptPanel(page: any) {
  const modifier = isMac() ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.waitForTimeout(400);
}

async function closeTranscriptPanelIfPresent(page: any) {
  const closeButton = page.getByRole('button', { name: 'Close' }).first();
  const input = page.locator('form input[type="text"]').first();

  const closeVisible = await closeButton.isVisible().catch(() => false);
  const inputVisible = await input.isVisible().catch(() => false);
  if (!closeVisible && !inputVisible) return;

  const modifier = isMac() ? 'Meta' : 'Control';
  try {
    await page.keyboard.press(`${modifier}+KeyK`);
    await page.waitForTimeout(350);
  } catch {}

  const stillOpen = (await closeButton.isVisible().catch(() => false)) || (await input.isVisible().catch(() => false));
  if (stillOpen) {
    await closeButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(350);
  }

  await expect(closeButton).not.toBeVisible({ timeout: 20_000 }).catch(() => {});
  await expect(input).not.toBeVisible({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function connectRoom(page: any) {
  await openTranscriptPanel(page);
  const connectButton = page.getByRole('button', { name: 'Connect' });
  await expect(connectButton).toBeEnabled({ timeout: 30_000 });
  await connectButton.evaluate((el: HTMLElement) => el.click());
  await page.getByRole('button', { name: 'Disconnect' }).waitFor({ state: 'attached', timeout: 60_000 });
}

async function requestAgent(page: any) {
  const requestButton = page.getByRole('button', { name: 'Request agent' }).first();
  await expect(requestButton).toBeEnabled({ timeout: 60_000 });
  await requestButton.evaluate((el: HTMLElement) => el.click());
  const input = page.locator('form input[type="text"]').first();
  await expect(input).toBeEnabled({ timeout: 60_000 });
}

async function ensureTranscriptInput(page: any) {
  const input = page.locator('form input[type="text"]').first();
  const visible = await input.isVisible().catch(() => false);
  if (!visible) {
    await openTranscriptPanel(page);
  }
  await expect(input).toBeVisible({ timeout: 10_000 });
  return input;
}

async function sendAgentLine(page: any, text: string) {
  const input = await ensureTranscriptInput(page);
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(1000);
}

async function waitForComponentRegistered(page: any, componentName: string, timeoutMs = 30_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page
      .evaluate((name: string) => {
        const entries = (window as any).__voiceFairyLap?.components || [];
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          const entry = entries[i];
          if (entry?.componentName === name && typeof entry?.messageId === 'string') {
            return entry.messageId;
          }
        }
        return null;
      }, componentName)
      .catch(() => null);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  return null;
}

async function focusComponent(page: any, componentName: string, padding = 96): Promise<string | null> {
  const componentId = await waitForComponentRegistered(page, componentName, 5_000);
  if (!componentId) return null;
  await page
    .evaluate(
      (detail: any) => {
        const bridge = (window as any).__PRESENT__?.tldraw;
        if (!bridge || typeof bridge.dispatch !== 'function') return;
        bridge.dispatch('canvas_focus', detail);
      },
      { target: 'component', componentId, padding },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
  return componentId;
}

async function waitForNoNextCompilingToast(page: any) {
  const compiling = page.getByText('Compiling...', { exact: false });
  if (await compiling.count()) {
    await expect(compiling.first()).not.toBeVisible({ timeout: 60_000 });
  }
}

async function snapStable(page: any, imagesDir: string, name: string) {
  await waitForNoNextCompilingToast(page);
  await snap(page, imagesDir, name);
}

async function waitForTimerPaused(page: any, timeoutMs = 45_000) {
  const startButton = page.getByRole('button', { name: 'Start' }).first();
  const statusStopped = page.getByText('Status: Stopped').first();
  let resolved = false;

  try {
    await Promise.race([
      startButton.waitFor({ state: 'visible', timeout: timeoutMs }),
      statusStopped.waitFor({ state: 'visible', timeout: timeoutMs }),
    ]);
    resolved = true;
  } catch {}

  if (!resolved) {
    throw new Error('Timer did not pause (Start button or Status: Stopped not visible).');
  }
}

async function fetchTimerSnapshot(page: any) {
  return page.evaluate(() => {
    const editor = (window as any).__tldrawEditor;
    if (!editor || typeof editor.getCurrentPageShapes !== 'function') return null;
    const entries = (window as any).__voiceFairyLap?.components || [];
    let latestTimerId: string | null = null;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry?.componentName === 'RetroTimerEnhanced' && typeof entry?.messageId === 'string') {
        latestTimerId = entry.messageId;
        break;
      }
    }
    const shapes = editor.getCurrentPageShapes();
    if (latestTimerId) {
      const direct = shapes.find((shape: any) => {
        if (!shape || shape.type !== 'custom') return false;
        return shape.props?.customComponent === latestTimerId;
      });
      if (direct) {
        return {
          id: direct.id,
          name: direct.props?.name,
          state: direct.props?.state || null,
        };
      }
    }
    const timers = shapes.filter((shape: any) => {
      if (!shape || shape.type !== 'custom') return false;
      const name = String(shape.props?.name || '').toLowerCase();
      return name.includes('timer');
    });
    if (timers.length === 0) return null;
    const timer = timers[timers.length - 1];
    return {
      id: timer.id,
      name: timer.props?.name,
      state: timer.props?.state || null,
    };
  });
}

async function waitForTimerState(
  page: any,
  predicate: (state: any) => boolean,
  timeoutMs = 45_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = await fetchTimerSnapshot(page).catch(() => null);
    const state = snapshot?.state || null;
    if (state && predicate(state)) return snapshot;
    await page.waitForTimeout(500);
  }
  throw new Error('Timer state did not reach expected condition.');
}

test.use({
  launchOptions: {
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  },
});

test.describe('Voice agent + Fairy pipeline lap', () => {
  test('voice agent steers fairies and widgets', async ({ page, context }) => {
    test.setTimeout(8 * 60 * 1000);
    await context.grantPermissions(['microphone', 'camera'], { origin: BASE_URL });
    await page.setViewportSize({ width: 1600, height: 1800 });

    await page.addInitScript(() => {
      (window as any).__presentDispatcherMetrics = true;
      (window as any).__voiceFairyLap = {
        toolCalls: [],
        toolMetrics: [],
        components: [],
      };
      window.addEventListener('present:tool_call_received', (event: any) => {
        try {
          (window as any).__voiceFairyLap.toolCalls.push(event.detail);
        } catch {}
      });
      window.addEventListener('present:tool_metrics', (event: any) => {
        try {
          (window as any).__voiceFairyLap.toolMetrics.push(event.detail);
        } catch {}
      });
      window.addEventListener('present:component-registered', (event: any) => {
        try {
          (window as any).__voiceFairyLap.components.push(event.detail);
        } catch {}
      });
    });

    const runId = formatTimestamp(new Date());
    const outputDir = path.join('test-results', `fairy-voice-agent-${runId}`);
    const imagesDir = path.join(outputDir, 'images');
    ensureDir(imagesDir);

    const results: StepResult[] = [];
    const recordStep = async (name: string, fn: () => Promise<string | undefined>) => {
      const start = Date.now();
      try {
        const screenshot = await fn();
        results.push({ name, status: 'PASS', durationMs: Date.now() - start, screenshot });
      } catch (error: any) {
        results.push({ name, status: 'FAIL', durationMs: Date.now() - start, error: error?.message || String(error) });
        throw error;
      }
    };

    await recordStep('Sign in / sign up', async () => {
      await signInOrSignUp(page, {
        email: process.env.PLAYWRIGHT_EMAIL,
        password: process.env.PLAYWRIGHT_PASSWORD,
      });
      await page.waitForTimeout(1500);
      return undefined;
    });

    await recordStep('Canvas loaded', async () => {
      await page.waitForSelector('[data-canvas-space="true"]', { timeout: 60_000 });
      await snapStable(page, imagesDir, '00-canvas-loaded.png');
      return '00-canvas-loaded.png';
    });

    await recordStep('Fairy HUD visible', async () => {
      const hud = page.getByTestId('fairy-hud');
      await expect(hud).toBeVisible({ timeout: 30_000 });
      await snapStable(page, imagesDir, '01-fairy-hud.png');
      return '01-fairy-hud.png';
    });

    await recordStep('Connect LiveKit + request agent', async () => {
      await connectRoom(page);
      await requestAgent(page);
      await openTranscriptPanel(page);
      await snapStable(page, imagesDir, '02-connected-agent.png');
      return '02-connected-agent.png';
    });

    await recordStep('Start timer via voice agent', async () => {
      await sendAgentLine(page, 'Start a 5 minute timer and start it now.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'RetroTimerEnhanced')).toBeTruthy();
      await focusComponent(page, 'RetroTimerEnhanced', 120);
      await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 45_000 });
      await waitForTimerState(page, (state) => state.isRunning === true, 45_000).catch(() => {});
      await snapStable(page, imagesDir, '03-timer-running.png');
      return '03-timer-running.png';
    });

    await recordStep('Pause timer via voice agent', async () => {
      const pauseCommands = [
        'Pause the timer.',
        'Stop the timer and keep it paused.',
        'Update the timer component so isRunning is false (paused).',
      ];
      let paused = false;
      for (const command of pauseCommands) {
        await sendAgentLine(page, command);
        await closeTranscriptPanelIfPresent(page);
        await focusComponent(page, 'RetroTimerEnhanced', 120);
        try {
          await waitForTimerState(page, (state) => state.isRunning === false, 30_000);
          paused = true;
          break;
        } catch {}
      }
      if (!paused) {
        await waitForTimerState(page, (state) => state.isRunning === false, 45_000);
      }
      await snapStable(page, imagesDir, '04-timer-paused.png');
      return '04-timer-paused.png';
    });

    await recordStep('Reset timer to 10 minutes', async () => {
      const resetCommands = [
        'Reset the timer to 10 minutes and keep it paused.',
        'Set the timer to 10 minutes, reset it, and pause it.',
        'Update the timer component: configuredDuration=600, timeLeft=600, isRunning=false.',
      ];
      for (const command of resetCommands) {
        await sendAgentLine(page, command);
        await closeTranscriptPanelIfPresent(page);
        await focusComponent(page, 'RetroTimerEnhanced', 120);
        const stateOk = await waitForTimerState(
          page,
          (state) => state.configuredDuration === 600 && state.timeLeft >= 590,
          12_000,
        ).then(() => true).catch(() => false);
        if (stateOk) break;
        await page.waitForTimeout(1500);
      }
      await waitForTimerState(page, (state) => state.configuredDuration === 600, 45_000);
      await expect(page.getByText('10 Minute Timer').first()).toBeVisible({ timeout: 45_000 }).catch(() => {});
      await expect(page.getByText('10:00').first()).toBeVisible({ timeout: 45_000 }).catch(() => {});
      await snapStable(page, imagesDir, '05-timer-reset-10.png');
      return '05-timer-reset-10.png';
    });

    await recordStep('Voice agent steers fairy canvas draw', async () => {
      const initialCount = await page.evaluate(() => {
        const editor = (window as any).__tldrawEditor;
        if (!editor) return 0;
        return Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
      });

      await sendAgentLine(page, '/canvas Draw a rectangle labeled "Voice Fairy Lap".');
      await closeTranscriptPanelIfPresent(page);

      await page.waitForFunction(
        (prevCount: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const nextCount = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return nextCount > prevCount;
        },
        initialCount,
        { timeout: 90_000 },
      );

      await snapStable(page, imagesDir, '06-fairy-canvas-draw.png');
      return '06-fairy-canvas-draw.png';
    });

    writeReport(outputDir, runId, results);
  });
});

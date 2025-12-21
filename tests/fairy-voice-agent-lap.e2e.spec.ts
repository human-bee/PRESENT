import { test, expect } from '@playwright/test';
import fs from 'node:fs';
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
  const statusText = page.getByText('Agent not joined', { exact: false });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visible = await requestButton.isVisible().catch(() => false);
    if (visible) {
      await expect(requestButton).toBeEnabled({ timeout: 30_000 });
      await requestButton.evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(500);
    }
    try {
      await expect(statusText).not.toBeVisible({ timeout: 30_000 });
      await expect(requestButton).not.toBeVisible({ timeout: 30_000 }).catch(() => {});
      return;
    } catch {}
  }
  await expect(statusText).not.toBeVisible({ timeout: 30_000 });
}

async function ensureTranscriptInput(page: any) {
  const input = page.locator('form input[type="text"]').first();
  const visible = await input.isVisible().catch(() => false);
  if (!visible) {
    await openTranscriptPanel(page);
  }
  const requestButton = page.getByRole('button', { name: 'Request agent' }).first();
  if (await requestButton.isVisible().catch(() => false)) {
    await requestAgent(page);
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

async function sendAgentLines(page: any, lines: string[], gapMs = 700) {
  for (const line of lines) {
    await sendAgentLine(page, line);
    await page.waitForTimeout(gapMs);
  }
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

async function waitForDispatchTask(page: any, task: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page
      .evaluate((targetTask: string) => {
        const calls = (window as any).__voiceFairyLap?.toolCalls || [];
        for (let i = calls.length - 1; i >= 0; i -= 1) {
          const call = calls[i];
          if (call?.tool === 'dispatch_to_conductor' && call?.task === targetTask) {
            return call;
          }
        }
        return null;
      }, task)
      .catch(() => null);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  throw new Error(`No dispatch_to_conductor tool call found for task "${task}".`);
}

type LapCounts = {
  toolCalls: number;
  toolMetrics: number;
  components: number;
  shapeCount: number;
  fairyRequests: number;
  stewardRequests: number;
};

async function getLapCounts(
  page: any,
  options: { fairyRequests: Array<unknown>; stewardRequests: Array<unknown> },
): Promise<LapCounts> {
  const base = await page.evaluate(() => {
    const toolCalls = (window as any).__voiceFairyLap?.toolCalls?.length ?? 0;
    const toolMetrics = (window as any).__voiceFairyLap?.toolMetrics?.length ?? 0;
    const components = (window as any).__voiceFairyLap?.components?.length ?? 0;
    const editor = (window as any).__tldrawEditor;
    const shapeCount = editor ? Array.from(editor.getCurrentPageShapeIds?.() ?? []).length : 0;
    return { toolCalls, toolMetrics, components, shapeCount };
  });
  return {
    ...base,
    fairyRequests: options.fairyRequests.length,
    stewardRequests: options.stewardRequests.length,
  };
}

function formatLapDelta(before: LapCounts, after: LapCounts) {
  const delta = {
    toolCalls: after.toolCalls - before.toolCalls,
    toolMetrics: after.toolMetrics - before.toolMetrics,
    components: after.components - before.components,
    shapeCount: after.shapeCount - before.shapeCount,
    fairyRequests: after.fairyRequests - before.fairyRequests,
    stewardRequests: after.stewardRequests - before.stewardRequests,
  };
  return `ΔtoolCalls=${delta.toolCalls}, Δmetrics=${delta.toolMetrics}, Δcomponents=${delta.components}, Δshapes=${delta.shapeCount}, ΔfairyReq=${delta.fairyRequests}, ΔstewardReq=${delta.stewardRequests}`;
}

async function getToolSummary(page: any) {
  return page.evaluate(() => {
    const calls = (window as any).__voiceFairyLap?.toolCalls || [];
    const summary: Record<string, number> = {};
    const taskSummary: Record<string, number> = {};
    for (const call of calls) {
      const tool = call?.tool || 'unknown';
      summary[tool] = (summary[tool] || 0) + 1;
      if (tool === 'dispatch_to_conductor' && call?.task) {
        const task = String(call.task);
        taskSummary[task] = (taskSummary[task] || 0) + 1;
      }
    }
    return { total: calls.length, summary, taskSummary };
  });
}

async function zoomToFitAllShapes(page: any, padding = 160) {
  await page
    .evaluate((pad: number) => {
      const editor = (window as any).__tldrawEditor;
      if (!editor) return;
      const ids = Array.from(editor.getCurrentPageShapeIds?.() ?? []);
      if (!ids.length) return;
      let bounds = null;
      for (const id of ids) {
        const b = editor.getShapePageBounds?.(id);
        if (!b) continue;
        bounds = bounds ? bounds.union(b) : b;
      }
      if (bounds) {
        editor.zoomToBounds?.(bounds, { inset: pad, animation: { duration: 0 } });
      }
    }, padding)
    .catch(() => {});
  await page.waitForTimeout(250);
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

async function snapStable(
  page: any,
  imagesDir: string,
  name: string,
  options?: { zoomToFit?: boolean; padding?: number },
) {
  await waitForNoNextCompilingToast(page);
  if (options?.zoomToFit) {
    await zoomToFitAllShapes(page, options.padding);
  }
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

async function getCustomComponentShape(page: any, messageId: string) {
  return page.evaluate((id: string) => {
    const editor = (window as any).__tldrawEditor;
    if (!editor || typeof editor.getCurrentPageShapes !== 'function') return null;
    const shapes = editor.getCurrentPageShapes();
    const match = shapes.find((shape: any) => {
      if (!shape || shape.type !== 'custom') return false;
      return shape.props?.customComponent === id;
    });
    if (!match) return null;
    return {
      id: match.id,
      name: match.props?.name,
      state: match.props?.state || null,
    };
  }, messageId);
}

async function waitForScorecardClaims(page: any, messageId: string, minClaims = 2, timeoutMs = 90_000) {
  await page.waitForFunction(
    (args: { id: string; min: number }) => {
      const { id, min } = args;
      const editor = (window as any).__tldrawEditor;
      if (!editor || typeof editor.getCurrentPageShapes !== 'function') return false;
      const shapes = editor.getCurrentPageShapes();
      const match = shapes.find((shape: any) => shape?.type === 'custom' && shape?.props?.customComponent === id);
      const state = match?.props?.state;
      if (!state || !Array.isArray(state.claims)) return false;
      return state.claims.length >= min;
    },
    { id: messageId, min: minClaims },
    { timeout: timeoutMs },
  );
}

async function waitForInfographicImage(page: any, previousCount = 0, timeoutMs = 180_000) {
  await page.waitForFunction(
    (prev: number) => {
      const images = document.querySelectorAll('img[alt="Generated Infographic"]');
      return images.length > prev;
    },
    previousCount,
    { timeout: timeoutMs },
  );
}

async function waitForIssueTitleInColumn(
  page: any,
  title: string,
  columnTitle?: string,
  timeoutMs = 120_000,
) {
  const target = title.trim();
  if (!target) return;
  await page.waitForFunction(
    (args: { title: string; columnTitle?: string }) => {
      const { title, columnTitle } = args;
      const headingMatches = Array.from(document.querySelectorAll('h2 span'))
        .filter((el) => el.textContent?.trim() === columnTitle);
      if (columnTitle && headingMatches.length > 0) {
        for (const heading of headingMatches) {
          const column = heading.closest('div');
          if (!column) continue;
          if (column.textContent?.includes(title)) {
            return true;
          }
        }
        return false;
      }
      return document.body.textContent?.includes(title) ?? false;
    },
    { title: target, columnTitle },
    { timeout: timeoutMs },
  );
}

async function ensureLinearKey(page: any, options?: { allowSkip?: boolean }) {
  const keyLabel = page.getByText('Linear API Key');
  const keyVisible = await keyLabel.isVisible().catch(() => false);
  if (!keyVisible) return { status: 'configured' as const };

  const apiKey = (process.env.LINEAR_API_KEY || '').trim();
  if (!apiKey) {
    if (options?.allowSkip) {
      return { status: 'missing' as const };
    }
    throw new Error('Linear API key panel is visible and LINEAR_API_KEY is not set.');
  }

  const input = page.getByPlaceholder('lin_api_...').first();
  const saveButton = page.getByRole('button', { name: 'Save' }).first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(apiKey);
  await saveButton.click();
  await page.waitForTimeout(800);
  await expect(page.getByText('✓ API Key configured')).toBeVisible({ timeout: 30_000 });
  return { status: 'saved' as const };
}

test.use({
  launchOptions: {
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  },
  video: 'on',
  viewport: { width: 1600, height: 900 },
});

test.describe('Voice agent + Fairy pipeline lap', () => {
  test('voice agent steers fairies and widgets', async ({ page, context }) => {
    test.setTimeout(8 * 60 * 1000);
    await context.grantPermissions(['microphone', 'camera'], { origin: BASE_URL });

    const fairyRequests: Array<{ body: string }> = [];
    const stewardRequests: Array<{ body: string }> = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/fairy/stream-actions')) {
        fairyRequests.push({ body: request.postData() || '' });
      }
      if (request.url().includes('/api/steward/runCanvas')) {
        stewardRequests.push({ body: request.postData() || '' });
      }
    });

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
    const recordStep = async (
      name: string,
      fn: () => Promise<{ screenshot?: string; notes?: string } | string | undefined>,
    ) => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      const start = Date.now();
      try {
        const raw = await fn();
        const payload = typeof raw === 'string' ? { screenshot: raw } : raw || {};
        const after = await getLapCounts(page, { fairyRequests, stewardRequests });
        const notes = [payload.notes, formatLapDelta(before, after)].filter(Boolean).join(' • ');
        results.push({
          name,
          status: 'PASS',
          durationMs: Date.now() - start,
          screenshot: payload.screenshot,
          notes,
        });
      } catch (error: any) {
        results.push({
          name,
          status: 'FAIL',
          durationMs: Date.now() - start,
          error: error?.message || String(error),
        });
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

    await recordStep('Warm API routes', async () => {
      await page.request.get(`${BASE_URL}/api/steward/runCanvas`).catch(() => {});
      await page.request.get(`${BASE_URL}/api/fairy/stream-actions`).catch(() => {});
      return undefined;
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

    await recordStep('Voice agent (LLM) steers fairy canvas draw', async () => {
      const initialCount = await page.evaluate(() => {
        const editor = (window as any).__tldrawEditor;
        if (!editor) return 0;
        return Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
      });

      await sendAgentLine(
        page,
        'Draw a rectangle labeled "Voice Fairy LLM Lap" on the canvas.',
      );
      await closeTranscriptPanelIfPresent(page);

      const dispatchDetail = await waitForDispatchTask(page, 'canvas.agent_prompt', 30_000);
      if (
        dispatchDetail?.dispatchMessage &&
        !String(dispatchDetail.dispatchMessage).includes('Voice Fairy LLM Lap')
      ) {
        throw new Error(`Canvas agent prompt did not include expected label. Got: ${dispatchDetail.dispatchMessage}`);
      }

      const waitForStewardRequest = async (timeoutMs = 120_000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const match = stewardRequests.find((entry) => entry.body.trim().length > 10);
          if (match) return match;
          await page.waitForTimeout(250);
        }
        const lengths = stewardRequests.map((entry) => entry.body.trim().length);
        throw new Error(
          `No /api/steward/runCanvas request with a non-empty body was captured. Count=${stewardRequests.length} lengths=${lengths.join(',')}`,
        );
      };
      const stewardRequest = await waitForStewardRequest();
      if (!stewardRequest.body.includes('canvas.agent_prompt')) {
        throw new Error(`Steward request did not include canvas.agent_prompt. Body: ${stewardRequest.body.slice(0, 200)}`);
      }

      const waitForFairyRequest = async (timeoutMs = 120_000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const match = fairyRequests.find((entry) => entry.body.trim().length > 10);
          if (match) return match;
          await page.waitForTimeout(250);
        }
        const lengths = fairyRequests.map((entry) => entry.body.trim().length);
        throw new Error(
          `No /api/fairy/stream-actions request with a non-empty body was captured. Count=${fairyRequests.length} lengths=${lengths.join(',')}`,
        );
      };
      await waitForFairyRequest();

      await page.waitForFunction(
        (prevCount: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const nextCount = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return nextCount > prevCount;
        },
        initialCount,
        { timeout: 120_000 },
      );

      await snapStable(page, imagesDir, '06-fairy-canvas-draw.png');
      return '06-fairy-canvas-draw.png';
    });

    const finalCounts = await getLapCounts(page, { fairyRequests, stewardRequests });
    const toolSummary = await getToolSummary(page);
    const dispatchTasks = Object.entries(toolSummary.taskSummary)
      .map(([task, count]) => `${task} (${count})`)
      .join(', ');
    writeReport(outputDir, runId, results, {
      metrics: [
        { label: 'Tool calls', value: String(toolSummary.total) },
        { label: 'Fairy requests', value: String(finalCounts.fairyRequests) },
        { label: 'Steward requests', value: String(finalCounts.stewardRequests) },
        { label: 'Components registered', value: String(finalCounts.components) },
        { label: 'Shape count', value: String(finalCounts.shapeCount) },
      ],
      notes: dispatchTasks ? [`dispatch_to_conductor tasks: ${dispatchTasks}`] : undefined,
    });
  });
});

test.describe('Voice agent + Fairy pipeline lap (medium)', () => {
  test('medium: duo fairies + debate + widgets', async ({ page, context }) => {
    test.setTimeout(12 * 60 * 1000);
    await context.grantPermissions(['microphone', 'camera'], { origin: BASE_URL });

    const video = page.video();
    const fairyRequests: Array<{ body: string }> = [];
    const stewardRequests: Array<{ body: string }> = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/fairy/stream-actions')) {
        fairyRequests.push({ body: request.postData() || '' });
      }
      if (request.url().includes('/api/steward/runCanvas')) {
        stewardRequests.push({ body: request.postData() || '' });
      }
    });

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
    const outputDir = path.join('test-results', `fairy-voice-agent-medium-${runId}`);
    const imagesDir = path.join(outputDir, 'images');
    ensureDir(imagesDir);

    const results: StepResult[] = [];
    const recordStep = async (
      name: string,
      fn: () => Promise<{ screenshot?: string; notes?: string } | string | undefined>,
    ) => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      const start = Date.now();
      try {
        const raw = await fn();
        const payload = typeof raw === 'string' ? { screenshot: raw } : raw || {};
        const after = await getLapCounts(page, { fairyRequests, stewardRequests });
        const notes = [payload.notes, formatLapDelta(before, after)].filter(Boolean).join(' • ');
        results.push({
          name,
          status: 'PASS',
          durationMs: Date.now() - start,
          screenshot: payload.screenshot,
          notes,
        });
      } catch (error: any) {
        results.push({
          name,
          status: 'FAIL',
          durationMs: Date.now() - start,
          error: error?.message || String(error),
        });
        throw error;
      }
    };

    let scorecardId: string | null = null;
    let infographicCountBefore = 0;

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

    await recordStep('Select duo fairies', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="fairy-toggle-"]').length >= 2,
        {},
        { timeout: 30_000 },
      );
      const toggles = page.locator('[data-testid^="fairy-toggle-"]');
      await toggles.first().click();
      await toggles.nth(1).click({ modifiers: ['Shift'] });
      await page.waitForSelector('.fairy-project-view', { timeout: 30_000 });
      await snapStable(page, imagesDir, '01-fairy-duo-selected.png');
      return '01-fairy-duo-selected.png';
    });

    await recordStep('Fairy duo draw-off', async () => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      const input = page.locator('.fairy-group-chat-input__field');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(
        'Two fairies: draw a fun head-to-head sketch contest. Left side: "Fairy A" mascot with a ribbon and 2 callouts. Right side: "Fairy B" mascot with a ribbon and 2 callouts. Add a centered title "Fairy Draw-Off". Keep everything within a 1200x800 area near the center.',
      );
      await input.press('Enter');
      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 6;
        },
        before.shapeCount,
        { timeout: 150_000 },
      );
      await snapStable(page, imagesDir, '02-fairy-draw-off.png', { zoomToFit: true, padding: 200 });
      return '02-fairy-draw-off.png';
    });

    await recordStep('Connect LiveKit + request agent', async () => {
      await connectRoom(page);
      await requestAgent(page);
      await openTranscriptPanel(page);
      await snapStable(page, imagesDir, '03-connected-agent.png');
      return '03-connected-agent.png';
    });

    await recordStep('Start timer via voice agent', async () => {
      await sendAgentLine(page, 'Start a 5 minute timer and start it now.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'RetroTimerEnhanced')).toBeTruthy();
      await focusComponent(page, 'RetroTimerEnhanced', 120);
      await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 45_000 });
      await waitForTimerState(page, (state) => state.isRunning === true, 45_000).catch(() => {});
      await snapStable(page, imagesDir, '04-timer-running.png', { zoomToFit: true, padding: 180 });
      return '04-timer-running.png';
    });

    await recordStep('Create debate scorecard', async () => {
      await sendAgentLine(page, 'Create a debate scorecard titled "Safety Evals Debate". Topic: Should AI labs publish safety evals before release?');
      await closeTranscriptPanelIfPresent(page);
      scorecardId = await waitForComponentRegistered(page, 'DebateScorecard', 60_000);
      if (!scorecardId) {
        throw new Error('DebateScorecard component was not registered.');
      }
      await focusComponent(page, 'DebateScorecard', 140);
      await snapStable(page, imagesDir, '05-scorecard-created.png', { zoomToFit: true, padding: 200 });
      return '05-scorecard-created.png';
    });

    await recordStep('Update scorecard + fact-check', async () => {
      await sendAgentLines(page, [
        'Affirmative: Mandatory safety evals increase transparency and improve accountability.',
        'Negative: Forced publication risks leaking exploits and slows innovation.',
        'Affirmative rebuttal: Summaries can preserve safety without revealing sensitive details.',
        'Negative rebuttal: Competitive pressure still incentivizes cutting corners.',
        'Judge: weigh transparency vs security; propose phased disclosure policy with redactions.',
        'Fact-check the two most important claims and add sources to the scorecard.',
      ]);
      await closeTranscriptPanelIfPresent(page);
      await waitForDispatchTask(page, 'scorecard.run', 60_000);
      await waitForDispatchTask(page, 'scorecard.fact_check', 120_000).catch(() => {});
      if (scorecardId) {
        await waitForScorecardClaims(page, scorecardId, 2, 120_000);
      }
      const snapshot = scorecardId ? await getCustomComponentShape(page, scorecardId) : null;
      const claimCount = Array.isArray(snapshot?.state?.claims) ? snapshot?.state?.claims.length : 0;
      const sourceCount = Array.isArray(snapshot?.state?.sources) ? snapshot?.state?.sources.length : 0;
      await snapStable(page, imagesDir, '06-scorecard-updated.png', { zoomToFit: true, padding: 200 });
      return {
        screenshot: '06-scorecard-updated.png',
        notes: `claims=${claimCount}, sources=${sourceCount}`,
      };
    });

    await recordStep('Generate infographic', async () => {
      infographicCountBefore = await page.evaluate(() => {
        return document.querySelectorAll('img[alt="Generated Infographic"]').length;
      });
      await sendAgentLine(page, 'Generate an infographic summarizing the debate and the fairy draw-off. Use grounding.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'InfographicWidget', 60_000)).toBeTruthy();
      await waitForInfographicImage(page, infographicCountBefore, 180_000);
      await snapStable(page, imagesDir, '07-infographic.png', { zoomToFit: true, padding: 200 });
      return '07-infographic.png';
    });

    await recordStep('Linear tickets added', async () => {
      await sendAgentLine(page, 'Create a Linear kanban board.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'LinearKanbanBoard', 90_000)).toBeTruthy();

      const keyStatus = await ensureLinearKey(page, { allowSkip: true });
      if (keyStatus.status === 'missing') {
        await snapStable(page, imagesDir, '08-linear-tickets.png', { zoomToFit: true, padding: 200 });
        return {
          screenshot: '08-linear-tickets.png',
          notes: 'Skipped Linear tickets (LINEAR_API_KEY not set).',
        };
      }

      const ticketA = 'Research: transparency vs secrecy tradeoff';
      const ticketB = 'Research: incentives vs safety eval rigor';
      await sendAgentLines(page, [
        `On the kanban board add a ticket titled "${ticketA}" and move it to Todo.`,
        `Also add a ticket titled "${ticketB}" and move it to Todo.`,
      ]);
      await closeTranscriptPanelIfPresent(page);

      await waitForIssueTitleInColumn(page, ticketA, 'Todo', 120_000);
      await waitForIssueTitleInColumn(page, ticketB, 'Todo', 120_000);
      await snapStable(page, imagesDir, '08-linear-tickets.png', { zoomToFit: true, padding: 200 });
      return {
        screenshot: '08-linear-tickets.png',
        notes: keyStatus.status === 'saved' ? 'Linear key saved from env.' : 'Linear key already configured.',
      };
    });

    await recordStep('Goodbye doodle', async () => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      await sendAgentLine(page, 'Draw a small goodbye doodle with the words "Thanks for watching" near the bottom-right.');
      await closeTranscriptPanelIfPresent(page);
      await waitForDispatchTask(page, 'canvas.agent_prompt', 60_000);
      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 2;
        },
        before.shapeCount,
        { timeout: 120_000 },
      );
      await snapStable(page, imagesDir, '09-goodbye-doodle.png', { zoomToFit: true, padding: 220 });
      return '09-goodbye-doodle.png';
    });

    await recordStep('Overview zoom', async () => {
      await zoomToFitAllShapes(page, 240);
      await snapStable(page, imagesDir, '10-overview.png');
      return '10-overview.png';
    });

    const finalCounts = await getLapCounts(page, { fairyRequests, stewardRequests });
    const toolSummary = await getToolSummary(page);
    const dispatchTasks = Object.entries(toolSummary.taskSummary)
      .map(([task, count]) => `${task} (${count})`)
      .join(', ');

    await page.close().catch(() => {});
    let videoArtifact: string | null = null;
    if (video) {
      const videoPath = await video.path().catch(() => null);
      if (videoPath) {
        const dest = path.join(outputDir, 'video.webm');
        try {
          fs.copyFileSync(videoPath, dest);
          videoArtifact = './video.webm';
        } catch {}
      }
    }

    writeReport(outputDir, runId, results, {
      metrics: [
        { label: 'Tool calls', value: String(toolSummary.total) },
        { label: 'Fairy requests', value: String(finalCounts.fairyRequests) },
        { label: 'Steward requests', value: String(finalCounts.stewardRequests) },
        { label: 'Components registered', value: String(finalCounts.components) },
        { label: 'Shape count', value: String(finalCounts.shapeCount) },
      ],
      artifacts: videoArtifact ? [{ label: 'Screen recording', path: videoArtifact }] : undefined,
      notes: dispatchTasks ? [`dispatch_to_conductor tasks: ${dispatchTasks}`] : undefined,
    });
  });
});

test.describe('Voice agent + Fairy pipeline lap (hard)', () => {
  test('hard: multi-fairy orchestration + multi-widget race', async ({ page, context }) => {
    test.setTimeout(15 * 60 * 1000);
    await context.grantPermissions(['microphone', 'camera'], { origin: BASE_URL });

    const video = page.video();
    const fairyRequests: Array<{ body: string }> = [];
    const stewardRequests: Array<{ body: string }> = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/fairy/stream-actions')) {
        fairyRequests.push({ body: request.postData() || '' });
      }
      if (request.url().includes('/api/steward/runCanvas')) {
        stewardRequests.push({ body: request.postData() || '' });
      }
    });

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
    const outputDir = path.join('test-results', `fairy-voice-agent-hard-${runId}`);
    const imagesDir = path.join(outputDir, 'images');
    ensureDir(imagesDir);

    const results: StepResult[] = [];
    const recordStep = async (
      name: string,
      fn: () => Promise<{ screenshot?: string; notes?: string } | string | undefined>,
    ) => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      const start = Date.now();
      try {
        const raw = await fn();
        const payload = typeof raw === 'string' ? { screenshot: raw } : raw || {};
        const after = await getLapCounts(page, { fairyRequests, stewardRequests });
        const notes = [payload.notes, formatLapDelta(before, after)].filter(Boolean).join(' • ');
        results.push({
          name,
          status: 'PASS',
          durationMs: Date.now() - start,
          screenshot: payload.screenshot,
          notes,
        });
      } catch (error: any) {
        results.push({
          name,
          status: 'FAIL',
          durationMs: Date.now() - start,
          error: error?.message || String(error),
        });
        throw error;
      }
    };

    let scorecardId: string | null = null;
    let infographicCountBefore = 0;

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

    await recordStep('Select three fairies', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="fairy-toggle-"]').length >= 3,
        {},
        { timeout: 30_000 },
      );
      const toggles = page.locator('[data-testid^="fairy-toggle-"]');
      await toggles.first().click();
      await toggles.nth(1).click({ modifiers: ['Shift'] });
      await toggles.nth(2).click({ modifiers: ['Shift'] });
      await page.waitForSelector('.fairy-project-view', { timeout: 30_000 });
      await snapStable(page, imagesDir, '01-fairy-group-selected.png');
      return '01-fairy-group-selected.png';
    });

    await recordStep('Fairy race orchestration', async () => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      const input = page.locator('.fairy-group-chat-input__field');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(
        'Three fairies: build a "Fairy Race Finale" scene. Two lanes with start/finish flags and lane labels "Fairy A" and "Fairy B". Add a scoreboard box showing A vs B, plus celebratory confetti around the title. Keep the scene within a 1400x900 area and leave space below for widgets.',
      );
      await input.press('Enter');
      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 10;
        },
        before.shapeCount,
        { timeout: 180_000 },
      );
      await snapStable(page, imagesDir, '02-fairy-race.png', { zoomToFit: true, padding: 220 });
      return '02-fairy-race.png';
    });

    await recordStep('Connect LiveKit + request agent', async () => {
      await connectRoom(page);
      await requestAgent(page);
      await openTranscriptPanel(page);
      await snapStable(page, imagesDir, '03-connected-agent.png');
      return '03-connected-agent.png';
    });

    await recordStep('Start timer via voice agent', async () => {
      await sendAgentLine(page, 'Start a 5 minute timer and start it now.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'RetroTimerEnhanced')).toBeTruthy();
      await focusComponent(page, 'RetroTimerEnhanced', 120);
      await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 45_000 });
      await waitForTimerState(page, (state) => state.isRunning === true, 45_000).catch(() => {});
      await snapStable(page, imagesDir, '04-timer-running.png', { zoomToFit: true, padding: 200 });
      return '04-timer-running.png';
    });

    await recordStep('Create debate scorecard', async () => {
      await sendAgentLine(page, 'Create a debate scorecard titled "AI Safety Evals Debate". Topic: Should AI labs publish safety evals before release?');
      await closeTranscriptPanelIfPresent(page);
      scorecardId = await waitForComponentRegistered(page, 'DebateScorecard', 60_000);
      if (!scorecardId) {
        throw new Error('DebateScorecard component was not registered.');
      }
      await focusComponent(page, 'DebateScorecard', 140);
      await snapStable(page, imagesDir, '05-scorecard-created.png', { zoomToFit: true, padding: 200 });
      return '05-scorecard-created.png';
    });

    await recordStep('Debate judged + fact-check', async () => {
      await sendAgentLines(page, [
        'Affirmative: Publishing evals builds public trust and drives safer release practices.',
        'Negative: Mandatory publication leaks sensitive details and can be gamed.',
        'Affirmative rebuttal: Redacted summaries still enable oversight without leaking exploits.',
        'Negative rebuttal: Competitive pressure reduces the incentive to be fully honest.',
        'Judge: prioritize transparency with safeguards; recommend phased disclosure and independent audits.',
        'Fact-check the top two factual claims and add sources.',
      ]);
      await closeTranscriptPanelIfPresent(page);
      await waitForDispatchTask(page, 'scorecard.run', 60_000);
      await waitForDispatchTask(page, 'scorecard.fact_check', 120_000).catch(() => {});
      if (scorecardId) {
        await waitForScorecardClaims(page, scorecardId, 2, 120_000);
      }
      const snapshot = scorecardId ? await getCustomComponentShape(page, scorecardId) : null;
      const claimCount = Array.isArray(snapshot?.state?.claims) ? snapshot?.state?.claims.length : 0;
      const sourceCount = Array.isArray(snapshot?.state?.sources) ? snapshot?.state?.sources.length : 0;
      await snapStable(page, imagesDir, '06-scorecard-updated.png', { zoomToFit: true, padding: 220 });
      return {
        screenshot: '06-scorecard-updated.png',
        notes: `claims=${claimCount}, sources=${sourceCount}`,
      };
    });

    await recordStep('Generate infographic', async () => {
      infographicCountBefore = await page.evaluate(() => {
        return document.querySelectorAll('img[alt="Generated Infographic"]').length;
      });
      await sendAgentLine(page, 'Generate an infographic summarizing the fairy race and debate verdict. Use grounding.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'InfographicWidget', 60_000)).toBeTruthy();
      await waitForInfographicImage(page, infographicCountBefore, 180_000);
      await snapStable(page, imagesDir, '07-infographic.png', { zoomToFit: true, padding: 220 });
      return '07-infographic.png';
    });

    await recordStep('Linear takeaway ticket', async () => {
      await sendAgentLine(page, 'Create a Linear kanban board.');
      await closeTranscriptPanelIfPresent(page);
      await expect(await waitForComponentRegistered(page, 'LinearKanbanBoard', 90_000)).toBeTruthy();

      const keyStatus = await ensureLinearKey(page, { allowSkip: true });
      if (keyStatus.status === 'missing') {
        await snapStable(page, imagesDir, '08-linear-takeaway.png', { zoomToFit: true, padding: 220 });
        return {
          screenshot: '08-linear-takeaway.png',
          notes: 'Skipped Linear takeaway (LINEAR_API_KEY not set).',
        };
      }

      const takeaway = 'Learn more: phased disclosure policies for safety evals';
      await sendAgentLine(page, `On the kanban board add a ticket titled "${takeaway}" and move it to Todo.`);
      await closeTranscriptPanelIfPresent(page);
      await waitForIssueTitleInColumn(page, takeaway, 'Todo', 120_000);
      await snapStable(page, imagesDir, '08-linear-takeaway.png', { zoomToFit: true, padding: 220 });
      return {
        screenshot: '08-linear-takeaway.png',
        notes: keyStatus.status === 'saved' ? 'Linear key saved from env.' : 'Linear key already configured.',
      };
    });

    await recordStep('Goodbye drawing finale', async () => {
      const before = await getLapCounts(page, { fairyRequests, stewardRequests });
      await sendAgentLine(page, 'Draw a celebratory goodbye banner that says "Fairy Finale" near the bottom of the canvas.');
      await closeTranscriptPanelIfPresent(page);
      await waitForDispatchTask(page, 'canvas.agent_prompt', 60_000);
      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 3;
        },
        before.shapeCount,
        { timeout: 150_000 },
      );
      await snapStable(page, imagesDir, '09-goodbye-finale.png', { zoomToFit: true, padding: 240 });
      return '09-goodbye-finale.png';
    });

    await recordStep('Overview zoom', async () => {
      await zoomToFitAllShapes(page, 260);
      await snapStable(page, imagesDir, '10-overview.png');
      return '10-overview.png';
    });

    const finalCounts = await getLapCounts(page, { fairyRequests, stewardRequests });
    const toolSummary = await getToolSummary(page);
    const dispatchTasks = Object.entries(toolSummary.taskSummary)
      .map(([task, count]) => `${task} (${count})`)
      .join(', ');

    await page.close().catch(() => {});
    let videoArtifact: string | null = null;
    if (video) {
      const videoPath = await video.path().catch(() => null);
      if (videoPath) {
        const dest = path.join(outputDir, 'video.webm');
        try {
          fs.copyFileSync(videoPath, dest);
          videoArtifact = './video.webm';
        } catch {}
      }
    }

    writeReport(outputDir, runId, results, {
      metrics: [
        { label: 'Tool calls', value: String(toolSummary.total) },
        { label: 'Fairy requests', value: String(finalCounts.fairyRequests) },
        { label: 'Steward requests', value: String(finalCounts.stewardRequests) },
        { label: 'Components registered', value: String(finalCounts.components) },
        { label: 'Shape count', value: String(finalCounts.shapeCount) },
      ],
      artifacts: videoArtifact ? [{ label: 'Screen recording', path: videoArtifact }] : undefined,
      notes: dispatchTasks ? [`dispatch_to_conductor tasks: ${dispatchTasks}`] : undefined,
    });
  });
});

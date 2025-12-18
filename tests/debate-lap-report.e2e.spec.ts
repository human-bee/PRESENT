import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:3000';
const DEFAULT_PASSWORD = 'Devtools123!';

type StepResult = {
  name: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  screenshot?: string;
  notes?: string;
  error?: string;
};

function isMac(): boolean {
  return process.platform === 'darwin';
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function openTranscriptPanel(page: any) {
  const modifier = isMac() ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(1_000);
}

async function closeTranscriptPanelIfPresent(page: any) {
  const closeButton = page.getByRole('button', { name: 'Close' }).first();
  const visible = await closeButton.isVisible().catch(() => false);
  if (!visible) return;

  const input = page.locator('form input[type="text"]').first();

  try {
    await closeButton.click({ force: true });
  } catch {
    const modifier = isMac() ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyK`);
  }

  // Wait for the slide-out animation to complete so it doesn't intercept clicks.
  await expect(closeButton).not.toBeVisible({ timeout: 20_000 }).catch(() => {});
  await expect(input).not.toBeVisible({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function zoomCanvasToFit(page: any) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tldraw:canvas_zoom_all'));
  });
  await page.waitForTimeout(400);
}

async function waitForNoNextCompilingToast(page: any) {
  const compiling = page.getByText('Compiling...', { exact: false });
  if (await compiling.count()) {
    await expect(compiling.first()).not.toBeVisible({ timeout: 60_000 });
  }
}

async function snap(page: any, imagesDir: string, name: string) {
  await waitForNoNextCompilingToast(page);
  await page.screenshot({ path: path.join(imagesDir, name) });
}

async function waitForComponentRegistered(
  page: any,
  componentName: string,
  timeoutMs = 30_000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page
      .evaluate((name: string) => {
        const entries = (window as any).__debateLap?.components || [];
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
  const componentId = await page
    .evaluate((name: string) => {
      const entries = (window as any).__debateLap?.components || [];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (entry?.componentName === name && typeof entry?.messageId === 'string') {
          return entry.messageId;
        }
      }
      return null;
    }, componentName)
    .catch(() => null);
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

async function signInOrSignUp(page: any, options: { email?: string; password?: string }) {
  const envEmail = (options.email || '').trim();
  const envPassword = (options.password || '').trim();
  const hasEnvCreds = Boolean(envEmail && envPassword);

  const randomEmail = `debate-lap+${Date.now()}_${Math.random().toString(36).slice(2, 6)}@present.local`;
  const email = hasEnvCreds ? envEmail : randomEmail;
  const password = hasEnvCreds ? envPassword : DEFAULT_PASSWORD;

  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'networkidle' });

  const trySignIn = async () => {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/canvas**', { timeout: 45_000 });
  };

  if (hasEnvCreds) {
    try {
      await trySignIn();
      return { email, password, mode: 'signin' as const };
    } catch {
      // Fall back to a fresh sign-up flow with a random email to avoid flaky auth failures.
    }
  }

  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: 'networkidle' });
  await page.getByLabel('Name').fill('Playwright Debate Lap');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/canvas**', { timeout: 60_000 });

  return { email, password, mode: 'signup' as const };
}

test.use({
  launchOptions: {
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  },
});

test.describe('5-minute debate lap (report)', () => {
  test('completes the lap and writes a verified screenshot report', async ({ page, context }) => {
    test.setTimeout(8 * 60 * 1000);
    await context.grantPermissions(['microphone', 'camera'], { origin: BASE_URL });
    await page.setViewportSize({ width: 1600, height: 1800 });

    await page.addInitScript(() => {
      (window as any).__presentDispatcherMetrics = true;
      (window as any).__debateLap = {
        toolCalls: [],
        toolMetrics: [],
        components: [],
      };
      window.addEventListener('present:tool_call_received', (event: any) => {
        try {
          (window as any).__debateLap.toolCalls.push(event.detail);
        } catch {}
      });
      window.addEventListener('present:tool_metrics', (event: any) => {
        try {
          (window as any).__debateLap.toolMetrics.push(event.detail);
        } catch {}
      });
      window.addEventListener('present:component-registered', (event: any) => {
        try {
          (window as any).__debateLap.components.push(event.detail);
        } catch {}
      });
    });

    const now = new Date();
    const roomName = `canvas-debate-lap-${formatTimestamp(now)}`;
    const reportDir = path.join(process.env.HOME || process.cwd(), 'Downloads', `present-demo-debate-lap-report-${formatTimestamp(now)}`);
    const imagesDir = path.join(reportDir, 'images');
    ensureDir(imagesDir);

    const stepResults: StepResult[] = [];
    const runStep = async (name: string, fn: () => Promise<{ screenshot?: string; notes?: string } | void>) => {
      const start = Date.now();
      try {
        const result = (await fn()) ?? {};
        stepResults.push({
          name,
          status: 'PASS',
          durationMs: Date.now() - start,
          screenshot: result.screenshot,
          notes: result.notes,
        });
      } catch (error) {
        stepResults.push({
          name,
          status: 'FAIL',
          durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    let failure: unknown = null;
    try {
      await runStep('Auth', async () => {
        await signInOrSignUp(page, {
          email: process.env.PLAYWRIGHT_EMAIL || process.env.PLAYWRIGHT_TEST_EMAIL,
          password: process.env.PLAYWRIGHT_PASSWORD || process.env.PLAYWRIGHT_TEST_PASSWORD,
        });
        await page.waitForTimeout(1_500);
      });

      await runStep('Pin room name', async () => {
        await page.evaluate((room) => {
          const url = new URL(window.location.href);
          url.searchParams.set('room', room);
          window.history.replaceState({}, '', url.toString());
        }, roomName);
      });

      await runStep('Connect + request agent', async () => {
        await connectRoom(page);
        await requestAgent(page);
        await openTranscriptPanel(page);
        await snap(page, imagesDir, '00-connected-agent.png');
        return { screenshot: 'images/00-connected-agent.png' };
      });

      // ---- 0:00–0:20 — Widgets ----
      await runStep('Timer running', async () => {
        await sendAgentLine(page, 'Start a 5 minute timer and start it now.');
        await closeTranscriptPanelIfPresent(page);
        await expect(await waitForComponentRegistered(page, 'RetroTimerEnhanced')).toBeTruthy();
        await focusComponent(page, 'RetroTimerEnhanced', 120);
        await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 30_000 });
        await snap(page, imagesDir, '01-timer-running.png');
        return { screenshot: 'images/01-timer-running.png' };
      });

      await runStep('Linear Kanban created', async () => {
        await sendAgentLine(page, 'Create a Linear Kanban board.');
        await closeTranscriptPanelIfPresent(page);
        await expect(await waitForComponentRegistered(page, 'LinearKanbanBoard')).toBeTruthy();
        await focusComponent(page, 'LinearKanbanBoard', 96);
        await expect(page.getByText('Linear Kanban Board').first()).toBeVisible({ timeout: 30_000 });
        await snap(page, imagesDir, '02-linear-kanban.png');
        return { screenshot: 'images/02-linear-kanban.png' };
      });

      const topic = 'Should AI labs be required to publish safety evals before release?';
      await runStep('Debate scorecard started', async () => {
        await sendAgentLine(page, `Start a debate analysis scorecard about: ${topic}`);
        await closeTranscriptPanelIfPresent(page);
        await expect(await waitForComponentRegistered(page, 'DebateScorecard')).toBeTruthy();
        await focusComponent(page, 'DebateScorecard', 72);
        await expect(page.getByText('Debate Analysis', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('heading', { name: topic })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText('Opponent').first()).toBeVisible({ timeout: 60_000 });
        await snap(page, imagesDir, '03-scorecard-start.png');
        return { screenshot: 'images/03-scorecard-start.png' };
      });

      await runStep('Debate captured + points incremented', async () => {
        const debateLines = [
          'Affirmative: Publishing evals reduces catastrophic risk and improves accountability.',
          'Negative: Mandatory pre-release eval publication risks leaks and slows innovation; do evals privately.',
          'Affirmative rebuttal: Private evals are not credible—publish *at least* summaries + methodology.',
          'Negative rebuttal: Publication incentives can lead to performative safety theater; focus on audits.',
          'Judge: weigh transparency benefits vs security/competition risks; propose phased disclosure policy.',
        ];
        for (const line of debateLines) {
          await sendAgentLine(page, line);
        }
        await closeTranscriptPanelIfPresent(page);
        await page.waitForTimeout(3_000);
        await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
        const pointsText = (await page.getByText('Total points exchanged:', { exact: false }).first().innerText()).trim();
        const pointsValue = Number.parseInt(pointsText.split(':').pop()?.trim() || '0', 10);
        expect(Number.isFinite(pointsValue) ? pointsValue : 0).toBeGreaterThan(0);
        await focusComponent(page, 'DebateScorecard', 72);
        await snap(page, imagesDir, '04-scorecard-updated.png');
        return {
          screenshot: 'images/04-scorecard-updated.png',
          notes: `Total points exchanged: ${pointsValue}`,
        };
      });

      await runStep('Fact-check + sources populated', async () => {
        await sendAgentLine(page, 'Fact-check the two most important factual claims and add sources to the scorecard.');
        await closeTranscriptPanelIfPresent(page);
        await focusComponent(page, 'DebateScorecard', 72);
        await page.getByRole('button', { name: 'Sources' }).click();
        await expect(page.getByText('No sources collected yet.')).toHaveCount(0, { timeout: 180_000 });
        await snap(page, imagesDir, '04b-scorecard-fact-checked.png');
        const sourceCount = await page.locator('a[href^="http"]').count().catch(() => 0);
        return { screenshot: 'images/04b-scorecard-fact-checked.png', notes: `Sources visible: ${sourceCount}` };
      });

      // ---- 4:00–5:00 — Canvas extravaganza ----
      await runStep('Canvas flowchart summary', async () => {
        await sendAgentLine(page, 'Canvas: create a clean flowchart summary of the debate (clear nodes + arrows).');
        await closeTranscriptPanelIfPresent(page);
        await page.waitForFunction(() => {
          const editor = (window as any)?.__present?.tldrawEditor;
          if (!editor) return false;
          const shapes = editor.getCurrentPageShapes?.() || [];
          const hasMermaid = shapes.some((s: any) => s?.type === 'mermaid_stream');
          const nonWidgets = shapes.filter((s: any) => !['custom', 'toolbox', 'infographic'].includes(s?.type));
          return hasMermaid || nonWidgets.length >= 3;
        }, null, { timeout: 120_000 });
        await zoomCanvasToFit(page);
        await snap(page, imagesDir, '05-canvas-flowchart.png');
        return { screenshot: 'images/05-canvas-flowchart.png' };
      });

      await runStep('Infographic generated', async () => {
        await sendAgentLine(page, 'Generate an infographic summarizing the debate.');
        await closeTranscriptPanelIfPresent(page);
        await expect(await waitForComponentRegistered(page, 'InfographicWidget')).toBeTruthy();
        await focusComponent(page, 'InfographicWidget', 96);
        await expect(page.getByAltText('Generated Infographic').first()).toBeVisible({ timeout: 180_000 });
        await snap(page, imagesDir, '06-infographic.png');
        return { screenshot: 'images/06-infographic.png' };
      });

      await runStep('Canvas doodle', async () => {
        await sendAgentLine(page, 'Canvas: add a playful doodle that represents the debate (fun but readable).');
        await closeTranscriptPanelIfPresent(page);
        await page.waitForFunction(() => {
          const editor = (window as any)?.__present?.tldrawEditor;
          if (!editor) return false;
          const shapes = editor.getCurrentPageShapes?.() || [];
          return shapes.some((s: any) => s?.type === 'draw');
        }, null, { timeout: 120_000 });
        await zoomCanvasToFit(page);
        await snap(page, imagesDir, '07-canvas-doodle.png');
        return { screenshot: 'images/07-canvas-doodle.png' };
      });

      const proTitle = `Demo Debate Lap: Research pro (transparency) ${formatTimestamp(now)}`;
      const conTitle = `Demo Debate Lap: Research con (private evals) ${formatTimestamp(now)}`;
      await runStep('Linear follow-up tickets', async () => {
        await sendAgentLine(
          page,
          `On the kanban board: add two tickets: "${proTitle}" assigned to me, and "${conTitle}" assigned to the other participant.`,
        );
        await closeTranscriptPanelIfPresent(page);
        await page.waitForTimeout(5_000);
        await expect(page.getByText(proTitle).first()).toBeVisible({ timeout: 120_000 });
        await expect(page.getByText(conTitle).first()).toBeVisible({ timeout: 120_000 });
        await focusComponent(page, 'LinearKanbanBoard', 96);
        await snap(page, imagesDir, '08-kanban-followups.png');
        return { screenshot: 'images/08-kanban-followups.png' };
      });

      await runStep('Overview (zoom all)', async () => {
        await zoomCanvasToFit(page);
        await snap(page, imagesDir, '09-overview.png');
        return { screenshot: 'images/09-overview.png' };
      });
    } catch (error) {
      failure = error;
      try {
        await snap(page, imagesDir, '99-failure.png');
      } catch {}
    } finally {
      const metrics = await page.evaluate(() => (window as any).__debateLap || null).catch(() => null);
      const toolCalls = Array.isArray(metrics?.toolCalls) ? metrics.toolCalls : [];
      const toolMetrics = Array.isArray(metrics?.toolMetrics) ? metrics.toolMetrics : [];

      const escapePipes = (value: string) => value.split('|').join('\\|');

      const toolCounts: Record<string, number> = {};
      const toolCountsBySource: Record<string, number> = {};
      for (const entry of toolCalls) {
        const tool = typeof entry?.tool === 'string' ? entry.tool : 'unknown';
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
        const source = typeof entry?.source === 'string' ? entry.source : 'unknown';
        toolCountsBySource[source] = (toolCountsBySource[source] || 0) + 1;
      }

      const avg = (values: number[]) =>
        values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
      const paintLatencies = toolMetrics
        .map((m: any) => (typeof m?.dtPaintMs === 'number' ? m.dtPaintMs : null))
        .filter((v: any): v is number => typeof v === 'number');
      const networkLatencies = toolMetrics
        .map((m: any) => (typeof m?.dtNetworkMs === 'number' ? m.dtNetworkMs : null))
        .filter((v: any): v is number => typeof v === 'number');

      const resultsTable = [
        '| Step | Status | Duration (ms) | Screenshot | Notes |',
        '|---|---:|---:|---|---|',
        ...stepResults.map((r) => {
          const shot = r.screenshot ? `[view](${r.screenshot})` : '';
          const notes = r.notes ? escapePipes(r.notes) : '';
          const status = r.status;
          return `| ${escapePipes(r.name)} | ${status} | ${r.durationMs} | ${shot} | ${notes} |`;
        }),
      ].join('\n');

      const formatCounts = (record: Record<string, number>) => {
        const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
        if (!entries.length) return '- (none)\n';
        return entries.map(([key, value]) => `- \`${key}\`: ${value}`).join('\n') + '\n';
      };

      const md = `# Debate Lap Screenshot Report\n\n` +
        `- Generated: ${new Date().toISOString()}\n` +
        `- Room: \`${roomName}\`\n` +
        `- Result: ${failure ? 'FAIL' : 'PASS'}\n\n` +
        `## Step Results\n\n` +
        `${resultsTable}\n\n` +
        `## Tool Call Counts\n\n` +
        `Total tool calls received: **${toolCalls.length}**\n\n` +
        `### By tool\n\n` +
        `${formatCounts(toolCounts)}\n` +
        `### By source\n\n` +
        `${formatCounts(toolCountsBySource)}\n` +
        `### Dispatcher latencies (from \`present:tool_metrics\`)\n\n` +
        `- Samples: ${toolMetrics.length}\n` +
        `- Avg network (send→arrive): ${avg(networkLatencies) ?? 'n/a'} ms\n` +
        `- Avg arrive→paint: ${avg(paintLatencies) ?? 'n/a'} ms\n\n` +
        `## Key Screenshots\n\n` +
        (() => {
          const shots = [
            { label: 'Connected + agent present', file: '00-connected-agent.png' },
            { label: 'Timer', file: '01-timer-running.png' },
            { label: 'Kanban', file: '02-linear-kanban.png' },
            { label: 'Scorecard start', file: '03-scorecard-start.png' },
            { label: 'Scorecard updated', file: '04-scorecard-updated.png' },
            { label: 'Scorecard fact-checked', file: '04b-scorecard-fact-checked.png' },
            { label: 'Flowchart', file: '05-canvas-flowchart.png' },
            { label: 'Infographic', file: '06-infographic.png' },
            { label: 'Doodle', file: '07-canvas-doodle.png' },
            { label: 'Kanban followups', file: '08-kanban-followups.png' },
            { label: 'Overview', file: '09-overview.png' },
          ];
          const rendered = shots
            .filter((shot) => fs.existsSync(path.join(imagesDir, shot.file)))
            .map((shot) => `![${shot.label}](images/${shot.file})`)
            .join('\n\n');
          const failureShot = fs.existsSync(path.join(imagesDir, '99-failure.png'))
            ? `\n\n## Failure screenshot\n\n![Failure](images/99-failure.png)\n`
            : '';
          return (rendered ? `${rendered}\n` : '- (no screenshots captured)\n') + failureShot;
        })();

      fs.writeFileSync(path.join(reportDir, 'debate-lap-report.md'), md, 'utf8');
      console.log('[debate-lap-report] wrote', reportDir);
    }

    if (failure) {
      throw failure;
    }
  });
});

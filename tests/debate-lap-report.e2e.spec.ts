import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'Devtools123!';

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

  try {
    await closeButton.click({ force: true });
  } catch {
    const modifier = isMac() ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyK`);
  }
  await page.waitForTimeout(300);
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

    const now = new Date();
    const roomName = `canvas-debate-lap-${formatTimestamp(now)}`;
    const reportDir = path.join(process.env.HOME || process.cwd(), 'Downloads', `present-demo-debate-lap-report-${formatTimestamp(now)}`);
    const imagesDir = path.join(reportDir, 'images');
    ensureDir(imagesDir);

    const email = `debate-lap+${Date.now()}_${Math.random().toString(36).slice(2, 6)}@present.local`;
    await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Sign up' }).click();
    await page.getByLabel('Name').fill('Playwright Debate Lap');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await page.waitForURL('**/canvas**', { timeout: 60_000 });
    await page.waitForTimeout(1_500);

    // Ensure room name is pinned (so agent + tool calls are scoped predictably).
    await page.evaluate((room) => {
      const url = new URL(window.location.href);
      url.searchParams.set('room', room);
      window.history.replaceState({}, '', url.toString());
    }, roomName);

    await connectRoom(page);
    await requestAgent(page);

    await openTranscriptPanel(page);
    await snap(page, imagesDir, '00-connected-agent.png');

    // ---- 0:00–0:20 — Widgets ----
    await sendAgentLine(page, 'Start a 5 minute timer and start it now.');
    await closeTranscriptPanelIfPresent(page);
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 30_000 });
    await snap(page, imagesDir, '01-timer-running.png');

    await sendAgentLine(page, 'Create a Linear Kanban board.');
    await closeTranscriptPanelIfPresent(page);
    await expect(page.getByText('Linear Kanban Board').first()).toBeVisible({ timeout: 30_000 });
    await snap(page, imagesDir, '02-linear-kanban.png');

    const topic = 'Should AI labs be required to publish safety evals before release?';
    await sendAgentLine(page, `Start a debate analysis scorecard about: ${topic}`);
    await closeTranscriptPanelIfPresent(page);
    await expect(page.getByText('Debate Analysis', { exact: true })).toBeVisible({ timeout: 30_000 });
    await snap(page, imagesDir, '03-scorecard-start.png');

    // ---- 0:20–4:00 — Debate (compressed) ----
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
    await snap(page, imagesDir, '04-scorecard-updated.png');

    // ---- 4:00–5:00 — Canvas extravaganza ----
    await sendAgentLine(page, 'Canvas: create a clean flowchart summary of the debate (clear nodes + arrows).');
    await closeTranscriptPanelIfPresent(page);
    await page.waitForFunction(() => {
      const editor = (window as any)?.__present?.tldrawEditor;
      if (!editor) return false;
      const shapes = editor.getCurrentPageShapes?.() || [];
      const nonWidgets = shapes.filter((s: any) => !['custom', 'toolbox', 'infographic', 'mermaid_stream'].includes(s?.type));
      return nonWidgets.length >= 3;
    }, null, { timeout: 120_000 });
    await zoomCanvasToFit(page);
    await snap(page, imagesDir, '05-canvas-flowchart.png');

    await sendAgentLine(page, 'Generate an infographic summarizing the debate.');
    await closeTranscriptPanelIfPresent(page);
    await expect(page.getByAltText('Generated Infographic').first()).toBeVisible({ timeout: 180_000 });
    await snap(page, imagesDir, '06-infographic.png');

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

    const proTitle = `Demo Debate Lap: Research pro (transparency) ${formatTimestamp(now)}`;
    const conTitle = `Demo Debate Lap: Research con (private evals) ${formatTimestamp(now)}`;
    await sendAgentLine(
      page,
      `On the kanban board: add two tickets: "${proTitle}" assigned to me, and "${conTitle}" assigned to the other participant.`,
    );
    await closeTranscriptPanelIfPresent(page);
    await page.waitForTimeout(5_000);
    await expect(page.getByText(proTitle).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(conTitle).first()).toBeVisible({ timeout: 120_000 });
    await snap(page, imagesDir, '08-kanban-followups.png');

    const md = `# Debate Lap Screenshot Report\n\n` +
      `- Generated: ${new Date().toISOString()}\n` +
      `- Room: \`${roomName}\`\n` +
      `- Verified: all steps asserted in Playwright\n\n` +
      `## Setup\n\n` +
      `![Connected + agent present](images/00-connected-agent.png)\n\n` +
      `## Widgets\n\n` +
      `### Timer running\n\n` +
      `![Timer](images/01-timer-running.png)\n\n` +
      `### Linear Kanban board\n\n` +
      `![Kanban](images/02-linear-kanban.png)\n\n` +
      `### Debate scorecard started\n\n` +
      `![Scorecard start](images/03-scorecard-start.png)\n\n` +
      `## Debate (compressed)\n\n` +
      `![Scorecard updated](images/04-scorecard-updated.png)\n\n` +
      `## Canvas extravaganza\n\n` +
      `### Flowchart summary\n\n` +
      `![Flowchart](images/05-canvas-flowchart.png)\n\n` +
      `### Infographic\n\n` +
      `![Infographic](images/06-infographic.png)\n\n` +
      `### Doodle\n\n` +
      `![Doodle](images/07-canvas-doodle.png)\n\n` +
      `### Linear followups\n\n` +
      `![Kanban followups](images/08-kanban-followups.png)\n`;

    fs.writeFileSync(path.join(reportDir, 'debate-lap-report.md'), md, 'utf8');

    console.log('[debate-lap-report] wrote', reportDir);
  });
});

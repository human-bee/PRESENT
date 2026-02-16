import { test, expect } from '@playwright/test';
import path from 'node:path';
import {
  formatTimestamp,
  ensureDir,
  signInOrSignUp,
  snap,
  writeReport,
  type StepResult,
} from './fairy-lap-utils';

type FairyCounts = {
  shapeCount: number;
  projectCount: number;
  taskCount: number;
  projectMemberCount: number;
};

async function getCounts(page: any): Promise<FairyCounts> {
  return page.evaluate(() => {
    const editor = (window as any).__tldrawEditor;
    const app = (window as any).__presentFairyApp;
    const shapeCount = editor ? Array.from(editor.getCurrentPageShapeIds?.() ?? []).length : 0;
    const projects = app?.projects?.getProjects?.() ?? [];
    const tasks = app?.tasks?.getTasks?.() ?? [];
    const projectCount = projects.length;
    const projectMemberCount = projects[0]?.members?.length ?? 0;
    return {
      shapeCount,
      projectCount,
      taskCount: tasks.length,
      projectMemberCount,
    };
  });
}

// Legacy client-side fairy swarm flow retained for historical reference only.
// Supported runtime path is server-first via /api/steward/runCanvas (see fairy-voice-agent-lap.e2e.spec.ts).
test.describe.skip('Fairy lap (medium, legacy client swarm)', () => {
  test('duo orchestration builds a simple artifact', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    const runId = formatTimestamp(new Date());
    const outputDir = path.join('test-results', `fairy-lap-medium-${runId}`);
    const imagesDir = path.join(outputDir, 'images');
    ensureDir(imagesDir);

    const results: StepResult[] = [];

    const recordStep = async (name: string, fn: () => Promise<{ screenshot?: string; notes?: string }>) => {
      const start = Date.now();
      try {
        const result = await fn();
        results.push({
          name,
          status: 'PASS',
          durationMs: Date.now() - start,
          screenshot: result?.screenshot,
          notes: result?.notes,
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
      await page.waitForTimeout(2_000);
      return {};
    });

    await recordStep('Canvas loaded', async () => {
      await page.waitForSelector('[data-canvas-space="true"]', { timeout: 60_000 });
      await snap(page, imagesDir, '00-canvas-loaded.png');
      return { screenshot: '00-canvas-loaded.png' };
    });

    await recordStep('Fairy HUD visible', async () => {
      const hud = page.getByTestId('fairy-hud');
      await expect(hud).toBeVisible({ timeout: 30_000 });
      await snap(page, imagesDir, '01-fairy-hud.png');
      return { screenshot: '01-fairy-hud.png' };
    });

    await recordStep('Select two fairies', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="fairy-toggle-"]').length >= 2,
        {},
        { timeout: 30_000 },
      );
      const toggles = page.locator('[data-testid^="fairy-toggle-"]');
      await toggles.first().click();
      await toggles.nth(1).click({ modifiers: ['Shift'] });
      await page.waitForSelector('.fairy-project-view', { timeout: 30_000 });
      await snap(page, imagesDir, '02-fairy-duo-selected.png');
      return { screenshot: '02-fairy-duo-selected.png' };
    });

    let initialCounts: FairyCounts | null = null;
    await recordStep('Send duo instruction', async () => {
      initialCounts = await getCounts(page);
      const input = page.locator('.fairy-group-chat-input__field');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(
        'Create a two-column pros/cons comparison titled "AI Safety Evals". Include a big title box, two column headers, at least 3 bullet callouts per column, and 2 arrows from the title to each column. Add a small legend with 3 colored keys.'
      );
      await input.press('Enter');
      await snap(page, imagesDir, '03-duo-prompt-sent.png');
      return { screenshot: '03-duo-prompt-sent.png' };
    });

    await recordStep('Duo project created + actions applied', async () => {
      await page.waitForFunction(() => {
        const app = (window as any).__presentFairyApp;
        return app && app.projects.getProjects().length > 0;
      }, {}, { timeout: 120_000 });

      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 6;
        },
        initialCounts?.shapeCount ?? 0,
        { timeout: 120_000 },
      );

      const finalCounts = await getCounts(page);
      await snap(page, imagesDir, '04-duo-actions.png');
      return {
        screenshot: '04-duo-actions.png',
        notes: `shapes ${initialCounts?.shapeCount ?? 0}→${finalCounts.shapeCount}, projects=${finalCounts.projectCount}, tasks=${finalCounts.taskCount}, members=${finalCounts.projectMemberCount}`,
      };
    });

    await recordStep('Follow-up expansion', async () => {
      const countsBefore = await getCounts(page);
      const input = page.locator('.fairy-group-chat-input__field');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(
        'Add two more bullet callouts per column and a compact summary box at the bottom with a one-sentence takeaway.'
      );
      await input.press('Enter');
      await snap(page, imagesDir, '05-duo-followup-sent.png');

      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 3;
        },
        countsBefore.shapeCount,
        { timeout: 120_000 },
      );

      const countsAfter = await getCounts(page);
      await snap(page, imagesDir, '06-duo-followup-actions.png');
      return {
        screenshot: '06-duo-followup-actions.png',
        notes: `shapes ${countsBefore.shapeCount}→${countsAfter.shapeCount}, tasks=${countsAfter.taskCount}`,
      };
    });

    writeReport(outputDir, runId, results);
  });
});

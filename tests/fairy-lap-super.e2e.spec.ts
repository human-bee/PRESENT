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

test.describe('Fairy lap (super)', () => {
  test('group orchestration builds a multi-step storyboard', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);

    const runId = formatTimestamp(new Date());
    const outputDir = path.join('test-results', `fairy-lap-super-${runId}`);
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
      await snap(page, imagesDir, '02-fairy-group-selected.png');
      return { screenshot: '02-fairy-group-selected.png' };
    });

    let initialCounts: FairyCounts | null = null;
    await recordStep('Send group instruction', async () => {
      initialCounts = await getCounts(page);
      const input = page.locator('.fairy-group-chat-input__field');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(
        'As a team, build a 6-step roadmap titled "Fairy Super Lap". Use numbered boxes, connect them with arrows, include one decision diamond with two branches, and add a legend explaining 3 color meanings plus a short summary note.'
      );
      await input.press('Enter');
      await snap(page, imagesDir, '03-group-prompt-sent.png');
      return { screenshot: '03-group-prompt-sent.png' };
    });

    await recordStep('Group project created + actions applied', async () => {
      await page.waitForFunction(() => {
        const app = (window as any).__presentFairyApp;
        return app && app.projects.getProjects().length > 0;
      }, {}, { timeout: 150_000 });

      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 8;
        },
        initialCounts?.shapeCount ?? 0,
        { timeout: 150_000 },
      );

      const finalCounts = await getCounts(page);
      await snap(page, imagesDir, '04-group-actions.png');
      return {
        screenshot: '04-group-actions.png',
        notes: `shapes ${initialCounts?.shapeCount ?? 0}→${finalCounts.shapeCount}, projects=${finalCounts.projectCount}, tasks=${finalCounts.taskCount}, members=${finalCounts.projectMemberCount}`,
      };
    });

    await recordStep('Follow-up expansion', async () => {
      const countsBefore = await getCounts(page);
      const input = page.locator('.fairy-group-chat-input__field');
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(
        'Add two callout notes near the decision branches, and a small footer box labeled "Next steps" with 3 bullets.'
      );
      await input.press('Enter');
      await snap(page, imagesDir, '05-group-followup-sent.png');

      await page.waitForFunction(
        (prev: number) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const next = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
          return next > prev + 4;
        },
        countsBefore.shapeCount,
        { timeout: 150_000 },
      );

      const countsAfter = await getCounts(page);
      await snap(page, imagesDir, '06-group-followup-actions.png');
      return {
        screenshot: '06-group-followup-actions.png',
        notes: `shapes ${countsBefore.shapeCount}→${countsAfter.shapeCount}, tasks=${countsAfter.taskCount}`,
      };
    });

    writeReport(outputDir, runId, results);
  });
});

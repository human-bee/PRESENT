import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatTimestamp,
  ensureDir,
  signInOrSignUp,
  snap,
  type StepResult,
} from './fairy-lap-utils';
import { writeScrapbookHtml } from './helpers/scrapbook-html';

const BASE_URL = 'http://localhost:3000';
const DEFAULT_PASSWORD = 'Devtools123!';

async function waitForBaseUrl(url: string, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function ensureToolDispatcherReady(page: any) {
  await page.waitForFunction(
    () => typeof (window as any).__presentToolDispatcherExecute === 'function',
    null,
    { timeout: 20_000 },
  );
}

async function invokeToolWithMetrics(page: any, call: any, timeoutMs = 12_000) {
  return await page.evaluate(
    ({ call, timeoutMs }) =>
      new Promise((resolve, reject) => {
        const exec = (window as any).__presentToolDispatcherExecute;
        if (typeof exec !== 'function') {
          reject(new Error('Tool dispatcher not ready'));
          return;
        }

        const targetMessageId =
          call?.payload?.params?.messageId || call?.payload?.params?.componentId || '';
        const targetTool = call?.payload?.tool;
        let response: any = null;

        const handler = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (!detail || typeof detail !== 'object') return;
          if (typeof detail.messageId !== 'string') return;
          if (detail.tool !== targetTool) return;
          if (targetMessageId && detail.messageId !== targetMessageId) return;
          if (typeof detail.dtPaintMs !== 'number') return;
          cleanup();
          resolve({ metrics: detail, response });
        };

        const cleanup = () => {
          window.removeEventListener('present:tool_metrics', handler as EventListener);
          window.clearTimeout(timeoutId);
        };

        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(
            new Error(`Timed out waiting for metrics for ${call.payload?.tool || 'unknown tool'}`),
          );
        }, timeoutMs);

        window.addEventListener('present:tool_metrics', handler as EventListener);

        Promise.resolve(exec(call))
          .then((result: any) => {
            response = result;
          })
          .catch((error: unknown) => {
            cleanup();
            reject(error);
          });
      }),
    { call, timeoutMs },
  );
}

async function waitForNoCompilingToast(page: any) {
  const compiling = page.getByText('Compiling...', { exact: false });
  if (await compiling.count()) {
    await expect(compiling.first()).not.toBeVisible({ timeout: 60_000 }).catch(() => {});
  }
}

async function waitForCanvasReady(page: any) {
  await page.waitForFunction(() => Boolean((window as any).__tldrawEditor), null, {
    timeout: 60_000,
  });
  const loading = page.getByText('Loading Canvas', { exact: false });
  if (await loading.count()) {
    await expect(loading.first()).not.toBeVisible({ timeout: 60_000 }).catch(() => {});
  }
}

type PerfRow = {
  label: string;
  durationMs: number;
  budgetMs: number;
};

function writeScrapbook(args: {
  outputPath: string;
  runId: string;
  dateStamp: string;
  results: StepResult[];
  perfRows: PerfRow[];
  notes: string[];
}) {
  const { outputPath, runId, dateStamp, results, perfRows, notes } = args;
  const totalMs = results.reduce((sum, step) => sum + step.durationMs, 0);
  const perfRowsFormatted = perfRows.map((row) => ({
    ...row,
    status: row.durationMs <= row.budgetMs ? 'PASS' : 'WARN',
  }));

  const findShot = (stepName: string) =>
    results.find((step) => step.name === stepName)?.screenshot;

  const heroShots = [
    {
      title: 'Conversation Summary (context spectrum)',
      screenshot: findShot('Update summary with decisions + action items'),
    },
    {
      title: 'Memory Recall (vector loop)',
      screenshot: findShot('Populate memory recall results'),
    },
    {
      title: 'MCP App View (tool + UI)',
      screenshot: findShot('Render MCP App view'),
    },
    {
      title: 'Presenter View Preset (fast lane)',
      screenshot: findShot('Apply presenter view preset (fast lane)'),
    },
  ].filter((shot) => shot.screenshot);

  const lines = [
    `# PRESENT User Story Scrapbook (${dateStamp})`,
    '',
    `Run ID: ${runId}`,
    '',
    '## Story Arc',
    '',
    'Conversation -> Action -> Memory -> Visuals -> View Orchestration',
    '',
    'This run demonstrates the new paradigms:',
    '- Fast-lane view presets (instant layout changes)',
    '- Context-spectrum widgets (summary + memory recall)',
    '- MCP App view rendering in-canvas',
    '- Tool-driven UI updates with measured paint latency',
    '',
    '## Hero Moments',
    '',
    ...heroShots.flatMap((shot) => [
      `### ${shot.title}`,
      '',
      `![${shot.title}](./assets/${dateStamp}/${shot.screenshot})`,
      '',
    ]),
    '## Journey Evidence (Screenshots)',
    '',
    '| Step | Status | Duration (ms) | Screenshot | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((step) => {
      const screenshot = step.screenshot
        ? `[${step.screenshot}](./assets/${dateStamp}/${step.screenshot})`
        : '';
      const notes = step.error ? `FAIL: ${step.error}` : step.notes || '';
      return `| ${step.name} | ${step.status} | ${step.durationMs} | ${screenshot} | ${notes} |`;
    }),
    '',
    '## Speed Benchmarks',
    '',
    '| Operation | Duration (ms) | Budget (ms) | Result |',
    '| --- | --- | --- | --- |',
    ...perfRowsFormatted.map((row) =>
      `| ${row.label} | ${row.durationMs} | ${row.budgetMs} | ${row.status} |`,
    ),
    '',
    `Total journey time: ${totalMs} ms`,
    '',
    '## Notes',
    ...notes.map((note) => `- ${note}`),
    '',
  ];

  fs.writeFileSync(outputPath, lines.join('\n'));

  const htmlOutputPath = outputPath.endsWith('.md')
    ? `${outputPath.slice(0, -3)}.html`
    : `${outputPath}.html`;

  writeScrapbookHtml({
    outputPath: htmlOutputPath,
    title: `PRESENT User Story Scrapbook (${dateStamp})`,
    runId,
    dateStamp,
    story: 'Conversation -> Action -> Memory -> Visuals -> View Orchestration',
    heroShots,
    results,
    perfRows,
    notes,
  });
}

test.describe('User story scrapbook', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__presentDispatcherMetrics = true;
      (window as any).__presentToolMetricsLog = [];
    });
  });

  test('runs a full journey and writes a scrapbook report', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    const runId = formatTimestamp(new Date());
    const dateStamp = formatDate(new Date());
    const imagesDir = path.join('docs', 'scrapbooks', 'assets', dateStamp);
    const outputPath = path.join('docs', 'scrapbooks', `${dateStamp}-journey.md`);
    ensureDir(imagesDir);

    const results: StepResult[] = [];
    const perfRows: PerfRow[] = [];
    const notes: string[] = [];

    const recordStep = async (name: string, fn: () => Promise<{ screenshot?: string; notes?: string }>) => {
      const start = Date.now();
      try {
        const payload = await fn();
        results.push({
          name,
          status: 'PASS',
          durationMs: Date.now() - start,
          screenshot: payload.screenshot,
          notes: payload.notes,
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
      await waitForBaseUrl(BASE_URL);
      await signInOrSignUp(page, {
        email: process.env.PLAYWRIGHT_EMAIL,
        password: process.env.PLAYWRIGHT_PASSWORD || DEFAULT_PASSWORD,
      });
      await page.waitForTimeout(1000);
      return {};
    });

    await recordStep('Canvas loaded', async () => {
      await page.goto(`${BASE_URL}/canvas`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-canvas-space="true"]', { timeout: 60_000 });
      await waitForCanvasReady(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-00-canvas.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot };
    });

    await ensureToolDispatcherReady(page);

    const summaryId = `journey-summary-${Date.now().toString(36)}`;
    const summaryCreate = await recordStep('Create meeting summary widget', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `create-summary-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'MeetingSummaryWidget',
            messageId: summaryId,
            spec: {
              title: 'Conversation Summary',
              contextProfile: 'deep',
              summary: '',
              highlights: [],
              decisions: [],
              actionItems: [],
              tags: ['journey'],
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'create_component (MeetingSummaryWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 1200,
      });

      await page.getByText('Conversation Summary', { exact: true }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-01-summary-created.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Update summary with decisions + action items', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `update-summary-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: summaryId,
            patch: {
              summary:
                'We aligned on a faster intent pipeline, agreed to ship MCP Apps UI hosting, and decided to track memory in a vector store.',
              highlights: [
                'Fast-lane view presets for instant layout changes',
                'Meeting summary auto-patches into the canvas',
                'Memory recall widget feeds follow-up context',
              ],
              decisions: ['Ship MCP Apps host runtime', 'Use Qdrant MCP locally'],
              actionItems: [
                { task: 'Wire MCP Apps demo server for UI resources', owner: 'Product' },
                { task: 'Run LiveKit + voice agent smoke test', owner: 'Engineering' },
              ],
              tags: ['fast-lane', 'memory'],
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'update_component (MeetingSummaryWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });

      await page.getByText('Highlights', { exact: true }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-02-summary-updated.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const recallId = `journey-recall-${Date.now().toString(36)}`;
    await recordStep('Create memory recall widget', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `create-recall-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'MemoryRecallWidget',
            messageId: recallId,
            spec: {
              title: 'Memory Recall',
              query: 'intent pipeline',
              autoSearch: false,
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'create_component (MemoryRecallWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 1200,
      });

      await page.getByText('Vector recall via MCP', { exact: true }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-03-memory-created.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Populate memory recall results', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `update-recall-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: recallId,
            patch: {
              results: [
                {
                  id: 'mem-1',
                  text: 'Intent ledger + fast-lane view presets reduced UI latency and improved focus.',
                  score: 0.91,
                  metadata: { source: 'journey-summary', tag: 'fast-lane' },
                },
                {
                  id: 'mem-2',
                  text: 'MCP Apps host runtime allows tools to ship their own UI views.',
                  score: 0.88,
                  metadata: { source: 'mcp-apps', tag: 'ui' },
                },
              ],
              lastUpdated: Date.now(),
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'update_component (MemoryRecallWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });

      await page.getByText('2 hits', { exact: false }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-04-memory-results.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const infographicId = `journey-info-${Date.now().toString(36)}`;
    await recordStep('Create infographic widget', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `create-infographic-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'InfographicWidget',
            messageId: infographicId,
            spec: {
              useGrounding: false,
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'create_component (InfographicWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 1400,
      });

      await page.getByText('Infographic', { exact: false }).first().waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-05-infographic.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const mcpId = `journey-mcp-${Date.now().toString(36)}`;
    await recordStep('Render MCP App view', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `create-mcp-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'McpAppWidget',
            messageId: mcpId,
            spec: {
              title: 'MCP App Demo',
              resourceUri: '/mcp-apps/demo.html',
              autoRun: false,
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'create_component (McpAppWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 1400,
      });

      await page.getByText('MCP App Demo', { exact: true }).waitFor({ timeout: 30_000 });
      const frame = page.frameLocator('iframe[title=\"MCP App Demo\"]');
      await frame.getByText('MCP App View', { exact: true }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-06-mcp-app.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const livekitConnectorId = `journey-livekit-${Date.now().toString(36)}`;
    const livekitTileIds = Array.from({ length: 3 }, (_, index) =>
      `journey-tile-${index}-${Date.now().toString(36)}`,
    );
    const screenShareId = `journey-screen-${Date.now().toString(36)}`;

    await recordStep('Spawn LiveKit tiles', async () => {
      await invokeToolWithMetrics(page, {
        id: `create-livekit-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'LivekitRoomConnector',
            messageId: livekitConnectorId,
            spec: {
              roomName: 'journey-demo',
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      for (const tileId of livekitTileIds) {
        await invokeToolWithMetrics(page, {
          id: `create-tile-${tileId}`,
          type: 'tool_call',
          payload: {
            tool: 'create_component',
            params: {
              type: 'LivekitParticipantTile',
              messageId: tileId,
              spec: {
                participantIdentity: `demo-${tileId.slice(-4)}`,
              },
            },
          },
          timestamp: Date.now(),
          source: 'playwright',
        });
      }

      await invokeToolWithMetrics(page, {
        id: `create-screen-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'LivekitScreenShareTile',
            messageId: screenShareId,
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      await page.waitForFunction(
        (id: string) => {
          const editor = (window as any).__tldrawEditor;
          if (!editor) return false;
          const shapes = editor.getCurrentPageShapes?.() || [];
          return shapes.some((shape: any) => shape?.props?.customComponent === id);
        },
        livekitTileIds[0],
        { timeout: 30_000 },
      );
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-07-livekit-tiles.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot };
    });

    await recordStep('Apply presenter view preset (fast lane)', async () => {
      const presetPerf = await page.evaluate(async (tileIds: string[]) => {
        const editor = (window as any).__tldrawEditor;
        if (!editor) return { durationMs: 0, moved: false };
        const shapes = editor.getCurrentPageShapes?.() || [];
        const getBounds = (messageId: string) => {
          const shape = shapes.find((item: any) => item?.props?.customComponent === messageId);
          if (!shape) return null;
          const bounds = editor.getShapePageBounds?.(shape.id);
          if (!bounds) return null;
          return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
        };

        const before = tileIds.map((id) => getBounds(id));
        const start = performance.now();
        window.dispatchEvent(
          new CustomEvent('tldraw:applyViewPreset', {
            detail: { preset: 'presenter', force: true },
          }),
        );

        const hasMoved = async () => {
          const nextShapes = editor.getCurrentPageShapes?.() || [];
          return tileIds.some((id, idx) => {
            const shape = nextShapes.find((item: any) => item?.props?.customComponent === id);
            if (!shape) return false;
            const bounds = editor.getShapePageBounds?.(shape.id);
            if (!bounds || !before[idx]) return false;
            return Math.abs(bounds.x - before[idx].x) > 2 || Math.abs(bounds.y - before[idx].y) > 2;
          });
        };

        const timeout = 2000;
        while (performance.now() - start < timeout) {
          const moved = await hasMoved();
          if (moved) {
            const duration = Math.round(performance.now() - start);
            return { durationMs: duration, moved: true };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return { durationMs: Math.round(performance.now() - start), moved: false };
      }, livekitTileIds);

      perfRows.push({
        label: 'fast-lane view preset (presenter)',
        durationMs: presetPerf.durationMs,
        budgetMs: 500,
      });

      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-08-view-preset.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `applied in ${presetPerf.durationMs} ms` };
    });

    notes.push('View preset is applied via tldraw:applyViewPreset (fast lane).');
    notes.push('Memory recall results are injected as a simulated MCP response for deterministic capture.');
    notes.push('MCP App demo uses a static ui resource (public/mcp-apps/demo.html).');

    writeScrapbook({
      outputPath,
      runId,
      dateStamp,
      results,
      perfRows,
      notes,
    });

    await expect(fs.existsSync(outputPath)).toBeTruthy();
  });
});

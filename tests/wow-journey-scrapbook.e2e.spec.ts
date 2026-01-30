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

const BASE_URL = 'http://localhost:3000';
const DEFAULT_PASSWORD = 'Devtools123!';

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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

async function waitForComponentShape(page: any, messageId: string, timeoutMs = 30_000) {
  await page.waitForFunction(
    (id: string) => {
      const editor = (window as any).__tldrawEditor;
      if (!editor) return false;
      const shapes = editor.getCurrentPageShapes?.() || [];
      return shapes.some((shape: any) => shape?.props?.customComponent === id);
    },
    messageId,
    { timeout: timeoutMs },
  );
}

async function zoomCanvas(page: any) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tldraw:canvas_zoom_all'));
  });
  await page.waitForTimeout(400);
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
      title: 'Debate Scorecard (multi-facet view)',
      screenshot: findShot('Seed debate scorecard'),
    },
    {
      title: 'Scorecard update (claims + metrics)',
      screenshot: findShot('Update scorecard signals'),
    },
    {
      title: 'MCP App View (tool + UI)',
      screenshot: findShot('Render MCP App view'),
    },
    {
      title: 'Presenter View Preset (fast lane)',
      screenshot: findShot('Apply presenter view preset'),
    },
  ].filter((shot) => shot.screenshot);

  const lines = [
    `# PRESENT Wow Journey Scrapbook (${dateStamp})`,
    '',
    `Run ID: ${runId}`,
    '',
    '## Story Arc',
    '',
    'Debate -> Verification -> Memory -> Visuals -> Live Layout',
    '',
    'This run demonstrates the new paradigms:',
    '- High-density debate scorecard with live metrics',
    '- Memory recall loop (vector intelligence)',
    '- MCP App view rendering inside the canvas',
    '- Fast-lane view presets for instant layout shifts',
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
      const notesText = step.error ? `FAIL: ${step.error}` : step.notes || '';
      return `| ${step.name} | ${step.status} | ${step.durationMs} | ${screenshot} | ${notesText} |`;
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
}

test.describe('Wow journey scrapbook', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__presentDispatcherMetrics = true;
      (window as any).__presentToolMetricsLog = [];
    });
  });

  test('runs a wow journey and writes a scrapbook report', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    const runId = formatTimestamp(new Date());
    const dateStamp = formatDate(new Date());
    const imagesDir = path.join('docs', 'scrapbooks', 'assets', dateStamp);
    const outputPath = path.join('docs', 'scrapbooks', `${dateStamp}-wow-journey.md`);
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
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-00-canvas.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot };
    });

    await ensureToolDispatcherReady(page);

    const debateId = `journey-debate-${Date.now().toString(36)}`;
    const now = Date.now();
    const scorecardState = {
      componentId: debateId,
      version: 1,
      topic: 'Should AI labs be required to publish safety evals?',
      round: 'Round 1',
      showMetricsStrip: true,
      factCheckEnabled: true,
      filters: {
        speaker: 'ALL',
        verdicts: [],
        statuses: [],
        searchQuery: '',
        activeTab: 'ledger',
      },
      metrics: {
        roundScore: 0.62,
        evidenceQuality: 0.74,
        judgeLean: 'NEUTRAL',
        excitement: 0.48,
      },
      players: [
        {
          id: 'player-aff',
          label: 'Affirmative',
          side: 'AFF',
          color: '#38bdf8',
          score: 2,
          streakCount: 1,
          momentum: 0.62,
          bsMeter: 0.08,
          learningScore: 0.62,
          achievements: [],
        },
        {
          id: 'player-neg',
          label: 'Negative',
          side: 'NEG',
          color: '#f87171',
          score: 1,
          streakCount: 0,
          momentum: 0.48,
          bsMeter: 0.1,
          learningScore: 0.53,
          achievements: [],
        },
      ],
      claims: [
        {
          id: 'claim-aff-1',
          side: 'AFF',
          speech: '1AC',
          quote: 'Publishing evals increases accountability and reduces catastrophic risk.',
          speaker: 'Aff',
          summary: 'Transparency requirements improve safety posture.',
          status: 'VERIFIED',
          strength: { logos: 0.74, pathos: 0.32, ethos: 0.62 },
          confidence: 0.72,
          evidenceCount: 2,
          upvotes: 3,
          scoreDelta: 1,
          verdict: 'ACCURATE',
          impact: 'MAJOR',
          createdAt: now - 600000,
          updatedAt: now - 560000,
          factChecks: [],
        },
        {
          id: 'claim-neg-1',
          side: 'NEG',
          speech: '1NC',
          quote: 'Mandates slow innovation and reduce global competitiveness.',
          speaker: 'Neg',
          summary: 'Compliance burden may shift progress overseas.',
          status: 'CHECKING',
          strength: { logos: 0.58, pathos: 0.35, ethos: 0.5 },
          confidence: 0.55,
          evidenceCount: 1,
          upvotes: 1,
          scoreDelta: -1,
          verdict: 'PARTIALLY_TRUE',
          impact: 'MINOR',
          createdAt: now - 540000,
          updatedAt: now - 520000,
          factChecks: [],
        },
      ],
      map: { nodes: [], edges: [] },
      rfd: { summary: 'Judge has not submitted an RFD yet.', links: [] },
      sources: [
        {
          id: 'src-1',
          title: 'NIST AI RMF',
          url: 'https://www.nist.gov/ai',
          credibility: 'HIGH',
          type: 'Government',
          lastVerified: '2025-12-01',
        },
        {
          id: 'src-2',
          title: 'UK AI Safety Summit Communique',
          url: 'https://www.gov.uk',
          credibility: 'MEDIUM',
          type: 'Government',
          lastVerified: '2025-11-20',
        },
      ],
      timeline: [
        {
          id: 'tl-1',
          timestamp: now - 580000,
          text: 'Aff: Publish evals to enforce accountability.',
          type: 'argument',
          side: 'AFF',
          claimId: 'claim-aff-1',
        },
        {
          id: 'tl-2',
          timestamp: now - 520000,
          text: 'Neg: Mandates slow innovation.',
          type: 'argument',
          side: 'NEG',
          claimId: 'claim-neg-1',
        },
      ],
      achievementsQueue: [],
      status: { lastAction: 'Seeded debate ledger', pendingVerifications: [] },
      lastUpdated: now,
    };

    await recordStep('Seed debate scorecard', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `create-debate-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'DebateScorecard',
            messageId: debateId,
            spec: scorecardState,
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'create_component (DebateScorecard)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 1400,
      });

      await page.getByText('Debate Analysis', { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByText('Should AI labs be required to publish safety evals?', { exact: true }).waitFor({ timeout: 30_000 });
      await zoomCanvas(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-01-debate-scorecard.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Update scorecard signals', async () => {
      const result: any = await invokeToolWithMetrics(page, {
        id: `update-debate-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: debateId,
            patch: {
              version: 2,
              lastUpdated: Date.now(),
              metrics: {
                roundScore: 0.68,
                evidenceQuality: 0.8,
                judgeLean: 'AFF',
                excitement: 0.55,
              },
              players: [
                { id: 'player-aff', side: 'AFF', label: 'Affirmative', score: 3, momentum: 0.7 },
                { id: 'player-neg', side: 'NEG', label: 'Negative', score: 1, momentum: 0.45 },
              ],
              status: { lastAction: 'Verified key affirmative claim', pendingVerifications: ['claim-neg-1'] },
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      });

      perfRows.push({
        label: 'update_component (DebateScorecard)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });

      await zoomCanvas(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-02-scorecard-updated.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const recallId = `wow-recall-${Date.now().toString(36)}`;
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
              title: 'Decision Memory',
              query: 'safety evals',
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

      await waitForComponentShape(page, recallId, 30_000);
      await zoomCanvas(page);
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
                  text: 'Consensus: safety eval transparency improves accountability without halting innovation.',
                  score: 0.92,
                  metadata: { source: 'debate', tag: 'consensus' },
                },
                {
                  id: 'mem-2',
                  text: 'Follow-up: compare policy proposals for eval disclosure cadence.',
                  score: 0.86,
                  metadata: { source: 'action-items', tag: 'followup' },
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
      await zoomCanvas(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-04-memory-results.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const mcpId = `wow-mcp-${Date.now().toString(36)}`;
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
      const frame = page.frameLocator('iframe[title="MCP App Demo"]');
      await frame.getByText('MCP App View', { exact: true }).waitFor({ timeout: 30_000 });
      await zoomCanvas(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-05-mcp-app.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    const livekitConnectorId = `wow-livekit-${Date.now().toString(36)}`;
    const livekitTileIds = Array.from({ length: 3 }, (_, index) =>
      `wow-tile-${index}-${Date.now().toString(36)}`,
    );
    const screenShareId = `wow-screen-${Date.now().toString(36)}`;

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
              roomName: 'wow-demo',
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

      await zoomCanvas(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-06-livekit-tiles.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot };
    });

    await recordStep('Apply presenter view preset', async () => {
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
      const screenshot = `${runId}-07-view-preset.png`;
      await snap(page, imagesDir, screenshot);
      return { screenshot, notes: `applied in ${presetPerf.durationMs} ms` };
    });

    notes.push('Debate scorecard seeded via create_component with structured state.');
    notes.push('Memory recall results are injected for deterministic visuals.');
    notes.push('MCP App demo uses a static ui resource (public/mcp-apps/demo.html).');
    notes.push('Presenter preset uses fast-lane tldraw:applyViewPreset.');

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

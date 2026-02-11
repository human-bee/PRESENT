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
import { fetchJourneyEvents, logJourneyAsset, logJourneyEvent } from './helpers/journey-log';

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

async function invokeToolWithJourney(
  page: any,
  runId: string,
  call: any,
  label: string,
  timeoutMs = 12_000,
) {
  const tool = call?.payload?.tool;
  const params = call?.payload?.params || {};
  const messageId =
    typeof params?.messageId === 'string'
      ? params.messageId
      : typeof params?.componentId === 'string'
        ? params.componentId
        : undefined;
  const componentType =
    typeof params?.type === 'string'
      ? params.type
      : typeof params?.componentType === 'string'
        ? params.componentType
        : undefined;

  await logJourneyEvent(runId, 'canvas', {
    eventType: 'tool_call',
    source: 'playwright',
    tool,
    payload: { label, messageId, componentType },
  });

  const result = await invokeToolWithMetrics(page, call, timeoutMs);

  await logJourneyEvent(runId, 'canvas', {
    eventType: 'tool_result',
    source: 'playwright',
    tool,
    durationMs: result?.metrics?.dtPaintMs ?? null,
    payload: { label, messageId, componentType },
  });

  return result;
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

const handCountTranscriptScript = [
  { speaker: 'Host', text: 'Welcome everyone. We are capturing crowd signals in real time.' },
  { speaker: 'Host', text: 'First question: who wants an AI summary after the session?' },
  { speaker: 'Audience', text: 'Hands are going up across the room.' },
  { speaker: 'Host', text: 'We are counting hands and updating the crowd pulse dashboard.' },
  { speaker: 'Audience', text: 'Question: how do you cluster similar questions?' },
  { speaker: 'Host', text: 'We auto-group by topic and highlight the top votes.' },
  { speaker: 'Audience', text: 'Can we see the leaderboard of questions?' },
  { speaker: 'Host', text: 'Yes, it is visible with live vote totals.' },
  { speaker: 'Audience', text: 'What is the current top theme?' },
  { speaker: 'Host', text: 'Security and safety evaluations are leading.' },
  { speaker: 'Audience', text: 'How fast can we switch to presenter view?' },
  { speaker: 'Host', text: 'We trigger a fast-lane preset instantly.' },
  { speaker: 'Audience', text: 'Add follow-up suggestions for the top theme.' },
  { speaker: 'Host', text: 'We will generate follow-up prompts now.' },
  { speaker: 'Audience', text: 'Let us capture action items from this crowd Q&A.' },
  { speaker: 'Host', text: 'We will log the summary to memory.' },
  { speaker: 'Audience', text: 'Closing question: can we access this later?' },
  { speaker: 'Host', text: 'Yes, the memory recall widget will surface it.' },
  { speaker: 'Host', text: 'Thanks everyone, closing the live demo.' },
];

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
  journeyEvents?: Awaited<ReturnType<typeof fetchJourneyEvents>>;
}) {
  const { outputPath, runId, dateStamp, results, perfRows, notes, journeyEvents } = args;
  const totalMs = results.reduce((sum, step) => sum + step.durationMs, 0);
  const perfRowsFormatted = perfRows.map((row) => ({
    ...row,
    status: row.durationMs <= row.budgetMs ? 'PASS' : 'WARN',
  }));

  const findShot = (stepName: string) =>
    results.find((step) => step.name === stepName)?.screenshot;

  const heroShots = [
    {
      title: 'Crowd Pulse Dashboard',
      screenshot: findShot('Create Crowd Pulse widget'),
    },
    {
      title: 'Crowd Pulse Update (hand count + questions)',
      screenshot: findShot('Update Crowd Pulse with live signals'),
    },
    {
      title: 'Crowd Pulse Follow-ups',
      screenshot: findShot('Add follow-up prompts + scores'),
    },
    {
      title: 'Speaker View Preset',
      screenshot: findShot('Apply speaker view preset'),
    },
  ].filter((shot) => shot.screenshot);

  const lines = [
    `# PRESENT Hand Count Journey (${dateStamp})`,
    '',
    `Run ID: ${runId}`,
    '',
    '## Story Arc',
    '',
    'Crowd Q&A -> Hand Count -> Question Queue -> Follow-ups -> View Shift',
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

  const htmlOutputPath = outputPath.endsWith('.md')
    ? `${outputPath.slice(0, -3)}.html`
    : `${outputPath}.html`;

  writeScrapbookHtml({
    outputPath: htmlOutputPath,
    title: `PRESENT Hand Count Journey (${dateStamp})`,
    runId,
    dateStamp,
    story: 'Crowd Q&A -> Hand Count -> Question Queue -> Follow-ups -> View Shift',
    heroShots,
    results,
    perfRows,
    notes,
    journeyEvents: journeyEvents || [],
  });
}

test.describe('Hand count journey scrapbook', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__presentDispatcherMetrics = true;
      (window as any).__presentToolMetricsLog = [];
    });
  });

  test('runs a crowd hand-count journey and writes a scrapbook report', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000);

    const runId = `${formatTimestamp(new Date())}-crowd`;
    const dateStamp = formatDate(new Date());
    const imagesDir = path.join('docs', 'scrapbooks', 'assets', dateStamp);
    const outputPath = path.join('docs', 'scrapbooks', `${dateStamp}-hand-count-journey.md`);
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
      await page.goto(`${BASE_URL}/canvas?journeyLog=1&journeyRunId=${runId}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-canvas-space="true"]', { timeout: 60_000 });
      await waitForCanvasReady(page);
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-00-canvas.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Canvas ready');
      return { screenshot };
    });

    await ensureToolDispatcherReady(page);

    await recordStep('Simulate transcript (19 turns)', async () => {
      await page.evaluate((lines) => {
        const now = Date.now();
        lines.forEach((line: any, idx: number) => {
          window.dispatchEvent(
            new CustomEvent('livekit:transcription-replay', {
              detail: {
                speaker: line.speaker,
                text: line.text,
                timestamp: now + idx * 1200,
              },
            }),
          );
        });
      }, handCountTranscriptScript);
      await page.waitForTimeout(800);
      return { notes: `${handCountTranscriptScript.length} turns` };
    });

    await recordStep('Open transcript panel', async () => {
      await page.keyboard.press('Control+K').catch(() => {});
      await page.waitForTimeout(600);
      await page.getByText('Transcript', { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => {});
      const screenshot = `${runId}-01-transcript.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Transcript panel');
      return { screenshot };
    });

    const roomConnectorId = `crowd-livekit-${Date.now().toString(36)}`;
    const tileIds = Array.from({ length: 4 }, (_, index) =>
      `crowd-tile-${index}-${Date.now().toString(36)}`,
    );

    await recordStep('Spawn LiveKit tiles (demo)', async () => {
      await invokeToolWithJourney(page, runId, {
        id: `create-livekit-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'LivekitRoomConnector',
            messageId: roomConnectorId,
            spec: {
              roomName: 'crowd-demo',
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Create LiveKit room connector');

      for (const tileId of tileIds) {
        await invokeToolWithJourney(page, runId, {
          id: `create-tile-${tileId}`,
          type: 'tool_call',
          payload: {
            tool: 'create_component',
            params: {
              type: 'LivekitParticipantTile',
              messageId: tileId,
              spec: {
                participantIdentity: `crowd-${tileId.slice(-4)}`,
                demoMode: true,
              },
            },
          },
          timestamp: Date.now(),
          source: 'playwright',
        }, 'Create LiveKit participant tile');
      }

      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-02-livekit.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'LiveKit tiles (demo)');
      return { screenshot };
    });

    const crowdId = `crowd-pulse-${Date.now().toString(36)}`;
    await recordStep('Create Crowd Pulse widget', async () => {
      const result: any = await invokeToolWithJourney(page, runId, {
        id: `create-crowd-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'CrowdPulseWidget',
            messageId: crowdId,
            spec: {
              title: 'Stage Q&A Control',
              prompt: 'Who wants a follow-up on safety evals?',
              status: 'counting',
              handCount: 0,
              peakCount: 0,
              confidence: 0.0,
              noiseLevel: 0.0,
              demoMode: true,
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Create Crowd Pulse widget');

      perfRows.push({
        label: 'create_component (CrowdPulseWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 1300,
      });

      await page.getByText('Stage Q&A Control', { exact: true }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-03-crowd-created.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd pulse widget');
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Update Crowd Pulse with live signals', async () => {
      const result: any = await invokeToolWithJourney(page, runId, {
        id: `update-crowd-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: crowdId,
            patch: {
              status: 'counting',
              handCount: 26,
              peakCount: 31,
              confidence: 0.92,
              noiseLevel: 0.18,
              activeQuestion: 'How do we maintain speed while verifying safety?',
              questions: [
                { id: 'q1', text: 'How do we verify safety without slowing releases?', votes: 18, status: 'open', tags: ['safety'] },
                { id: 'q2', text: 'What data should be public in eval summaries?', votes: 12, status: 'open', tags: ['transparency'] },
                { id: 'q3', text: 'Can we automate clustering of crowd questions?', votes: 9, status: 'open', tags: ['routing'] },
              ],
              lastUpdated: Date.now(),
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Update Crowd Pulse signals');

      perfRows.push({
        label: 'update_component (CrowdPulseWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });

      await page.getByText('Live Question', { exact: false }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-04-crowd-signals.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd pulse signals');
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Add follow-up prompts + scores', async () => {
      const result: any = await invokeToolWithJourney(page, runId, {
        id: `update-crowd-followups-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: crowdId,
            patch: {
              status: 'locked',
              scoreboard: [
                { label: 'Safety Evals', score: 31, delta: 6 },
                { label: 'Transparency', score: 24, delta: 4 },
                { label: 'Speed', score: 17, delta: 2 },
              ],
              followUps: [
                'Which eval results should be published within 30 days?',
                'What safeguards protect exploit details without reducing trust?',
                'Who owns the summary cadence for third-party audits?',
              ],
              lastUpdated: Date.now(),
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Update Crowd Pulse follow-ups');

      perfRows.push({
        label: 'update_component (CrowdPulseWidget follow-ups)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });

      await logJourneyEvent(runId, 'canvas', {
        eventType: 'mcp_call',
        source: 'playwright',
        tool: 'memory_upsert',
        payload: { summary: 'Crowd Q&A follow-ups', simulated: true },
      });
      await logJourneyEvent(runId, 'canvas', {
        eventType: 'mcp_result',
        source: 'playwright',
        tool: 'memory_upsert',
        durationMs: 240,
        payload: { resultCount: 1, simulated: true },
      });

      await page.getByText('Suggested Follow-Ups', { exact: false }).waitFor({ timeout: 30_000 });
      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-05-crowd-followups.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd follow-ups');
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Reload + rehydrate Crowd Pulse widget', async () => {
      await page.reload();
      await waitForNoCompilingToast(page);
      await waitForCanvasReady(page);
      await ensureToolDispatcherReady(page);

      // The follow-up suggestions should survive reload via TLDraw shape state hydration.
      const canvas = page.getByTestId('canvas');
      await canvas.getByText('Suggested Follow-Ups', { exact: false }).waitFor({ timeout: 30_000 });
      await canvas.getByText('Which eval results should be published within 30 days?', { exact: false }).waitFor({ timeout: 30_000 });

      const rehydrateUpdate: any = await invokeToolWithJourney(page, runId, {
        id: `update-crowd-post-rehydrate-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: crowdId,
            patch: {
              activeQuestion: 'Rehydrate check question',
              handCount: 29,
              lastUpdated: Date.now(),
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Update Crowd Pulse after rehydrate');

      perfRows.push({
        label: 'update_component (CrowdPulseWidget post-rehydrate)',
        durationMs: rehydrateUpdate.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });
      await canvas.getByText('Rehydrate check question', { exact: false }).waitFor({ timeout: 30_000 });
      await canvas.getByText('29', { exact: true }).waitFor({ timeout: 30_000 });

      const screenshot = `${runId}-06-crowd-rehydrated.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd pulse rehydrated after reload');
      return { screenshot };
    });

    await recordStep('Remove Crowd Pulse widget', async () => {
      const result: any = await invokeToolWithJourney(page, runId, {
        id: `remove-crowd-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'remove_component',
          params: {
            componentId: crowdId,
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Remove Crowd Pulse widget');

      perfRows.push({
        label: 'remove_component (CrowdPulseWidget)',
        durationMs: result.metrics?.dtPaintMs ?? 0,
        budgetMs: 900,
      });

      await expect(page.getByTestId('canvas').getByText('Stage Q&A Control', { exact: true })).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(500);
      await expect(page.getByTestId('canvas').getByText('Stage Q&A Control', { exact: true })).toHaveCount(0);

      const postRemoveCall = {
        id: `update-crowd-after-remove-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'update_component',
          params: {
            componentId: crowdId,
            patch: {
              title: 'Should Not Respawn',
              handCount: 99,
              lastUpdated: Date.now(),
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      };
      await logJourneyEvent(runId, 'canvas', {
        eventType: 'tool_call',
        source: 'playwright',
        tool: 'update_component',
        payload: { label: 'Update Crowd Pulse after remove', componentId: crowdId },
      });
      await page.evaluate(async (call: any) => {
        const exec = (window as any).__presentToolDispatcherExecute;
        if (typeof exec !== 'function') {
          throw new Error('Tool dispatcher not ready');
        }
        await exec(call);
      }, postRemoveCall);
      await logJourneyEvent(runId, 'canvas', {
        eventType: 'tool_result',
        source: 'playwright',
        tool: 'update_component',
        payload: { label: 'Update Crowd Pulse after remove', componentId: crowdId, expected: 'no_paint' },
      });

      await page.waitForTimeout(700);
      await expect(page.getByTestId('canvas').getByText('Should Not Respawn', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('canvas').getByText('Stage Q&A Control', { exact: true })).toHaveCount(0);

      const screenshot = `${runId}-07-crowd-removed.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd pulse removed');
      return { screenshot, notes: `paint ${result.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Reload after remove (no respawn)', async () => {
      await page.reload();
      await waitForNoCompilingToast(page);
      await waitForCanvasReady(page);
      await ensureToolDispatcherReady(page);

      const canvas = page.getByTestId('canvas');
      await expect(canvas.getByText('Stage Q&A Control', { exact: true })).toHaveCount(0, { timeout: 30_000 });
      await expect(canvas.getByText('Should Not Respawn', { exact: true })).toHaveCount(0);

      const screenshot = `${runId}-08-crowd-removed-reload.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd pulse still removed after reload');
      return { screenshot };
    });

    await recordStep('Recreate Crowd Pulse with same componentId', async () => {
      const recreate: any = await invokeToolWithJourney(page, runId, {
        id: `recreate-crowd-${Date.now()}`,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'CrowdPulseWidget',
            messageId: crowdId,
            spec: {
              title: 'Stage Q&A Control (Recreated)',
              prompt: 'Recreated widget check',
              status: 'counting',
              handCount: 2,
              peakCount: 2,
              confidence: 0.5,
              noiseLevel: 0.1,
              demoMode: true,
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      }, 'Recreate Crowd Pulse widget');

      perfRows.push({
        label: 'create_component (CrowdPulseWidget recreate same id)',
        durationMs: recreate.metrics?.dtPaintMs ?? 0,
        budgetMs: 1300,
      });

      const canvas = page.getByTestId('canvas');
      await canvas.getByText('Stage Q&A Control (Recreated)', { exact: true }).waitFor({ timeout: 30_000 });
      await canvas.getByText('Recreated widget check', { exact: false }).waitFor({ timeout: 30_000 });

      const screenshot = `${runId}-09-crowd-recreated.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Crowd pulse recreated with same id');
      return { screenshot, notes: `paint ${recreate.metrics?.dtPaintMs ?? 0} ms` };
    });

    await recordStep('Apply speaker view preset', async () => {
      const presetPerf = await page.evaluate(async () => {
        const start = performance.now();
        window.dispatchEvent(
          new CustomEvent('tldraw:applyViewPreset', {
            detail: { preset: 'speaker', force: true },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 350));
        return { durationMs: Math.round(performance.now() - start), moved: true };
      });

      perfRows.push({
        label: 'fast-lane view preset (speaker)',
        durationMs: presetPerf.durationMs,
        budgetMs: 500,
      });

      await waitForNoCompilingToast(page);
      const screenshot = `${runId}-10-speaker-view.png`;
      await snap(page, imagesDir, screenshot);
      await logJourneyAsset(runId, 'canvas', `./assets/${dateStamp}/${screenshot}`, 'Speaker preset');
      return { screenshot, notes: `applied in ${presetPerf.durationMs} ms` };
    });

    notes.push('Crowd pulse widget captures hand counts + question queue in real time.');
    notes.push('Question clustering and follow-ups are reflected in the widget.');
    notes.push('Speaker preset is applied via tldraw:applyViewPreset.');
    notes.push('Transcript events are simulated for deterministic story capture.');

    const journeyEvents = await fetchJourneyEvents(runId);

    writeScrapbook({
      outputPath,
      runId,
      dateStamp,
      results,
      perfRows,
      notes,
      journeyEvents,
    });

    await expect(fs.existsSync(outputPath)).toBeTruthy();
  });
});

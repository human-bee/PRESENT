import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk';

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isMac(): boolean {
  return process.platform === 'darwin';
}

function resolveLiveKitRestUrl(): string | null {
  const raw =
    process.env.LIVEKIT_REST_URL ||
    process.env.LIVEKIT_URL ||
    process.env.NEXT_PUBLIC_LK_SERVER_URL ||
    process.env.LIVEKIT_HOST;
  if (!raw) return null;
  let url = raw.trim();
  if (url.startsWith('wss://')) url = `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) url = `http://${url.slice(5)}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  return url.replace(/\/+$/, '');
}

async function waitForCanvasReady(page: any) {
  await page.waitForSelector('[data-canvas-space="true"]', { timeout: 90_000 });
  await page.waitForFunction(() => {
    const editor = (window as any).__present?.tldrawEditor;
    return !!editor;
  }, null, { timeout: 90_000 });
  await page.waitForFunction(
    () =>
      (window as any).__present?.tldrawSync?.status === 'synced-remote' &&
      (window as any).__present?.tldrawSync?.connectionStatus === 'online',
    null,
    { timeout: 90_000 },
  );
}

async function ensureToolDispatcherReady(page: any) {
  await page.waitForFunction(
    () => typeof (window as any).__presentToolDispatcherExecute === 'function',
    null,
    { timeout: 20_000 },
  );
}

async function invokeToolWithMetrics(page: any, call: any, timeoutMs = 15_000) {
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

        const handler = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (!detail || typeof detail !== 'object') return;
          if (typeof detail.messageId !== 'string') return;
          if (detail.tool !== targetTool) return;
          if (targetMessageId && detail.messageId !== targetMessageId) return;
          if (typeof detail.dtPaintMs !== 'number') return;
          cleanup();
          resolve(detail);
        };

        const cleanup = () => {
          window.removeEventListener('present:tool_metrics', handler as EventListener);
          window.clearTimeout(timeoutId);
        };

        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for metrics for ${call.payload?.tool || 'unknown tool'}`));
        }, timeoutMs);

        window.addEventListener('present:tool_metrics', handler as EventListener);

        Promise.resolve(exec(call)).catch((error: unknown) => {
          cleanup();
          reject(error);
        });
      }),
    { call, timeoutMs },
  );
}

async function waitForComponentShapeId(page: any, componentId: string, timeoutMs = 20_000) {
  await page.waitForFunction(
    (messageId: string) => {
      const editor = (window as any).__present?.tldrawEditor;
      if (!editor) return false;
      const shapes = editor.getCurrentPageShapes?.() ?? [];
      return shapes.some((shape: any) => shape?.type === 'custom' && shape?.props?.customComponent === messageId);
    },
    componentId,
    { timeout: timeoutMs },
  );
  return await page.evaluate((messageId: string) => {
    const editor = (window as any).__present?.tldrawEditor;
    const shapes = editor.getCurrentPageShapes?.() ?? [];
    const found = shapes.find((shape: any) => shape?.type === 'custom' && shape?.props?.customComponent === messageId);
    return found?.id ?? null;
  }, componentId);
}

async function focusComponent(page: any, componentId: string, padding = 120) {
  await page
    .evaluate(
      ({ componentId, padding }: { componentId: string; padding: number }) => {
        const bridge = (window as any).__PRESENT__?.tldraw;
        if (!bridge || typeof bridge.dispatch !== 'function') return;
        bridge.dispatch('canvas_focus', { target: 'component', componentId, padding });
      },
      { componentId, padding },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}

async function zoomToFitAllShapes(page: any, padding = 160) {
  await page
    .evaluate((pad: number) => {
      const editor = (window as any).__present?.tldrawEditor;
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

async function openTranscriptPanel(page: any) {
  const modifier = isMac() ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.waitForTimeout(600);
}

async function sendLiveKitTranscripts(roomName: string, lines: Array<{ speaker: string; participantId: string; text: string }>) {
  const restUrl = resolveLiveKitRestUrl();
  const apiKey = process.env.LIVEKIT_API_KEY || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || '';
  if (!restUrl || !apiKey || !apiSecret) {
    return { ok: false as const, reason: 'missing_livekit_rest_creds' as const };
  }

  const client = new RoomServiceClient(restUrl, apiKey, apiSecret);
  for (const line of lines) {
    const payload = {
      type: 'live_transcription',
      event_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: line.text,
      speaker: line.speaker,
      participantId: line.participantId,
      participantName: line.speaker,
      timestamp: Date.now(),
      is_final: true,
      manual: false,
    };
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await client.sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic: 'transcription' });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return { ok: true as const };
}

test.describe('prod showcase screenshots', () => {
  test('captures verified multi-user + widgets + transcript + local pin', async ({ browser }, testInfo) => {
    const runId = `showcase-${stamp()}`;
    const outDir = path.join(process.cwd(), 'docs', 'scrapbooks', 'assets', 'showcase', runId);
    fs.mkdirSync(outDir, { recursive: true });

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    await ctxA.addInitScript(() => {
      window.localStorage.setItem('present:display_name', 'Alice');
    });
    await ctxB.addInitScript(() => {
      window.localStorage.setItem('present:display_name', 'Bob');
    });

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto('/canvas', { waitUntil: 'domcontentloaded' });
    await waitForCanvasReady(pageA);

    const canvasId = await pageA.evaluate(() => new URL(window.location.href).searchParams.get('id'));
    expect(canvasId).toBeTruthy();

    await pageB.goto(`/canvas?id=${encodeURIComponent(String(canvasId))}`, { waitUntil: 'domcontentloaded' });
    await waitForCanvasReady(pageB);

    // Wait for LiveKit to connect (CanvasParityAutopilot with NEXT_PUBLIC_LIVEKIT_AUTO_CONNECT).
    await pageA.waitForFunction(() => (window as any).__present?.livekitConnected === true, null, { timeout: 90_000 });
    await pageB.waitForFunction(() => (window as any).__present?.livekitConnected === true, null, { timeout: 90_000 });

    const roomName = await pageA.evaluate(() => (window as any).__present?.livekitRoomName || '');
    expect(roomName).toBeTruthy();

    // Optional: verify the LiveKit voice agent actually joins (requires worker online).
    if (process.env.PLAYWRIGHT_EXPECT_AGENT === '1') {
      await pageA.waitForFunction(() => (window as any).__present?.livekitHasAgent === true, null, { timeout: 120_000 });
      await pageB.waitForFunction(() => (window as any).__present?.livekitHasAgent === true, null, { timeout: 120_000 });
    }

    await ensureToolDispatcherReady(pageA);

    const nonce = Date.now().toString(36);
    const weatherId = `showcase-weather-${nonce}`;
    const youtubeId = `showcase-youtube-${nonce}`;
    const scorecardId = `showcase-scorecard-${nonce}`;
    const linearId = `showcase-linear-${nonce}`;
    const infographicId = `showcase-infographic-${nonce}`;

    // Weather (uses /api/weather fallback in prod if MCP is unavailable).
    await invokeToolWithMetrics(pageA, {
      id: `create-${weatherId}`,
      type: 'tool_call',
      payload: {
        tool: 'create_component',
        params: {
          type: 'WeatherForecast',
          messageId: weatherId,
          spec: { location: 'San Francisco, CA', periods: [], x: 80, y: 520 },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });
    const weatherShapeId = await waitForComponentShapeId(pageA, weatherId);

    // YouTube search (requires YOUTUBE_API_KEY configured in the app).
    await invokeToolWithMetrics(pageA, {
      id: `create-${youtubeId}`,
      type: 'tool_call',
      payload: {
        tool: 'create_component',
        params: {
          type: 'YoutubeSearchEnhanced',
          messageId: youtubeId,
          spec: {
            title: 'YouTube Search (Prod)',
            initialQuery: 'tldraw collaboration',
            autoSearch: true,
            showTranscripts: true,
            showTrending: true,
            maxResults: 12,
            x: 560,
            y: 520,
          },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });
    await waitForComponentShapeId(pageA, youtubeId);

    // Debate scorecard (pure UI; no external deps).
    await invokeToolWithMetrics(pageA, {
      id: `create-${scorecardId}`,
      type: 'tool_call',
      payload: {
        tool: 'create_component',
        params: {
          type: 'DebateScorecard',
          messageId: scorecardId,
          spec: {
            componentId: scorecardId,
            version: 3,
            topic: 'Showcase: Multi-participant + Fairy-first',
            round: 'Round 1',
            claims: [
              {
                id: 'claim-1',
                side: 'AFF',
                speech: '1AC',
                quote: 'We now persist transcripts append-only to avoid timeouts.',
                speaker: 'Alice',
                status: 'VERIFIED',
                verdict: 'ACCURATE',
                impact: 'MAJOR',
                confidence: 0.9,
                evidenceCount: 3,
                upvotes: 2,
                scoreDelta: 1,
                strength: { logos: 0.9, pathos: 0.4, ethos: 0.7 },
                factChecks: [
                  {
                    id: 'fc-1',
                    summary: 'Verified via Supabase schema + successful prod run.',
                    tags: ['supabase', 'transcript'],
                    evidenceRefs: [],
                  },
                ],
                createdAt: Date.now() - 600_000,
                updatedAt: Date.now() - 120_000,
              },
              {
                id: 'claim-2',
                side: 'NEG',
                speech: '1NC',
                quote: 'Pins and view-layout actions no longer fight between users.',
                speaker: 'Bob',
                status: 'VERIFIED',
                verdict: 'ACCURATE',
                impact: 'KEY_VOTER',
                confidence: 0.85,
                evidenceCount: 2,
                upvotes: 1,
                scoreDelta: 1,
                strength: { logos: 0.8, pathos: 0.3, ethos: 0.7 },
                factChecks: [],
                createdAt: Date.now() - 540_000,
                updatedAt: Date.now() - 90_000,
              },
            ],
            sources: [
              {
                id: 'src-1',
                title: 'Supabase migrations',
                url: 'https://supabase.com/',
                credibility: 'HIGH',
                type: 'Government',
              },
            ],
            lastUpdated: Date.now(),
            x: 80,
            y: 80,
          },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });
    await waitForComponentShapeId(pageA, scorecardId);

    // Linear kanban (demo data; does not require Linear key to render).
    await invokeToolWithMetrics(pageA, {
      id: `create-${linearId}`,
      type: 'tool_call',
      payload: {
        tool: 'create_component',
        params: {
          type: 'LinearKanbanBoard',
          messageId: linearId,
          spec: {
            title: 'Linear (Showcase)',
            statuses: [
              { id: 'Todo', type: 'backlog', name: 'Todo' },
              { id: 'In Progress', type: 'started', name: 'In Progress' },
              { id: 'Done', type: 'completed', name: 'Done' },
            ],
            issues: [
              {
                id: 'issue-1',
                identifier: 'PRES-12',
                title: 'Multi-participant transcription in prod',
                status: 'In Progress',
                updatedAt: new Date().toISOString(),
                priority: { value: 2, name: 'High' },
                labels: ['livekit', 'realtime'],
                assignee: 'Alice',
              },
              {
                id: 'issue-2',
                identifier: 'PRES-15',
                title: 'Fairy-first canvas manipulation',
                status: 'Todo',
                updatedAt: new Date().toISOString(),
                priority: { value: 1, name: 'Urgent' },
                labels: ['tldraw', 'ui'],
                assignee: 'Bob',
              },
              {
                id: 'issue-3',
                identifier: 'PRES-18',
                title: 'Widget reliability hardening',
                status: 'Done',
                updatedAt: new Date().toISOString(),
                priority: { value: 3, name: 'Medium' },
                labels: ['weather', 'youtube'],
                assignee: 'Team',
              },
            ],
            x: 1450,
            y: 80,
          },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });
    await waitForComponentShapeId(pageA, linearId);

    // Infographic (renders inside the canvas shape; optional to actually generate).
    await invokeToolWithMetrics(pageA, {
      id: `create-${infographicId}`,
      type: 'tool_call',
      payload: {
        tool: 'create_component',
        params: {
          type: 'InfographicWidget',
          messageId: infographicId,
          spec: {
            componentId: infographicId,
            isShape: true,
            useGrounding: false,
            x: 1450,
            y: 600,
          },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });
    await waitForComponentShapeId(pageA, infographicId);

    // Screenshot: full canvas with all widgets (A and B).
    await zoomToFitAllShapes(pageA, 200);
    await zoomToFitAllShapes(pageB, 200);
    const shotCanvasA = path.join(outDir, '01-canvas-a.png');
    const shotCanvasB = path.join(outDir, '01-canvas-b.png');
    await pageA.screenshot({ path: shotCanvasA, fullPage: true });
    await pageB.screenshot({ path: shotCanvasB, fullPage: true });
    testInfo.attach('canvas-a', { path: shotCanvasA, contentType: 'image/png' });
    testInfo.attach('canvas-b', { path: shotCanvasB, contentType: 'image/png' });

    // Transcript attribution (inject via LiveKit data channel).
    await openTranscriptPanel(pageA);
    const transcriptResult = await sendLiveKitTranscripts(String(roomName), [
      { speaker: 'Alice', participantId: 'alice', text: 'Weather + YouTube widgets are live in prod.' },
      { speaker: 'Bob', participantId: 'bob', text: 'I see them too. Canvas sync is working across users.' },
    ]);
    // Wait for text to appear (best-effort).
    await pageA.getByText('Weather + YouTube widgets are live in prod.', { exact: false }).waitFor({ timeout: 15_000 }).catch(() => {});
    const shotTranscript = path.join(outDir, '02-transcript.png');
    await pageA.screenshot({ path: shotTranscript, fullPage: true });
    testInfo.attach('transcript', { path: shotTranscript, contentType: 'image/png' });

    // Widget close-ups.
    await focusComponent(pageA, weatherId, 140);
    await pageA.waitForTimeout(1200);
    const shotWeather = path.join(outDir, '03-weather.png');
    await pageA.screenshot({ path: shotWeather, fullPage: true });

    await focusComponent(pageA, youtubeId, 140);
    // Wait for at least one video card thumbnail (best-effort).
    await pageA.locator(`[data-component-id="${youtubeId}"] img`).first().waitFor({ timeout: 25_000 }).catch(() => {});
    const shotYoutube = path.join(outDir, '04-youtube.png');
    await pageA.screenshot({ path: shotYoutube, fullPage: true });

    await focusComponent(pageA, scorecardId, 180);
    const shotScorecard = path.join(outDir, '05-scorecard.png');
    await pageA.screenshot({ path: shotScorecard, fullPage: true });

    await focusComponent(pageA, linearId, 180);
    const shotLinear = path.join(outDir, '06-linear.png');
    await pageA.screenshot({ path: shotLinear, fullPage: true });

    // Infographic generation is async + potentially costly; keep best-effort and time-bounded.
    await focusComponent(pageA, infographicId, 160);
    await pageA.getByRole('button', { name: 'Generate Infographic' }).click().catch(() => {});
    await pageA.getByText('Provider:', { exact: false }).waitFor({ timeout: 60_000 }).catch(() => {});
    const shotInfographic = path.join(outDir, '07-infographic.png');
    await pageA.screenshot({ path: shotInfographic, fullPage: true });

    // Local-only pin: pin the Weather component on A only, then screenshot A vs B.
    if (weatherShapeId) {
      await pageA.evaluate(
        ({ roomName, shapeId }: { roomName: string; shapeId: string }) => {
          const key = `present:pins:${(roomName || 'canvas').trim() || 'canvas'}`;
          const raw = window.localStorage.getItem(key);
          let next: any = {};
          try {
            next = raw ? JSON.parse(raw) : {};
          } catch {
            next = {};
          }
          next[shapeId] = { pinnedX: 0.86, pinnedY: 0.18 };
          window.localStorage.setItem(key, JSON.stringify(next));
          window.dispatchEvent(
            new CustomEvent('present:pins-changed', {
              detail: { roomName, shapeId },
            }),
          );
        },
        { roomName: String(roomName), shapeId: String(weatherShapeId) },
      );
      await pageA.waitForTimeout(600);
    }

    await zoomToFitAllShapes(pageA, 240);
    await zoomToFitAllShapes(pageB, 240);
    const shotPinA = path.join(outDir, '08-local-pin-a.png');
    const shotPinB = path.join(outDir, '08-local-pin-b.png');
    await pageA.screenshot({ path: shotPinA, fullPage: true });
    await pageB.screenshot({ path: shotPinB, fullPage: true });

    const manifest = {
      runId,
      baseURL: process.env.PLAYWRIGHT_BASE_URL || testInfo.project.use.baseURL || null,
      canvasId,
      roomName,
      transcriptInjection: transcriptResult,
      assets: [
        path.basename(shotCanvasA),
        path.basename(shotCanvasB),
        path.basename(shotTranscript),
        path.basename(shotWeather),
        path.basename(shotYoutube),
        path.basename(shotScorecard),
        path.basename(shotLinear),
        path.basename(shotInfographic),
        path.basename(shotPinA),
        path.basename(shotPinB),
      ],
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    await ctxA.close();
    await ctxB.close();
  });
});

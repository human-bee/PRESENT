import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function waitForCanvasReady(page: any) {
  await page.waitForSelector('[data-canvas-space="true"]', { timeout: 90_000 });
  await page.waitForFunction(() => {
    const editor = (window as any).__present?.tldrawEditor || (window as any).__PRESENT__?.tldraw;
    return !!editor;
  }, null, { timeout: 90_000 });
}

test.describe('prod canvas sync smoke', () => {
  test('two users see the same TLDraw doc and join LiveKit', async ({ browser }, testInfo) => {
    const runId = `prod-sync-${stamp()}`;
    const outDir = path.join(process.cwd(), 'docs', 'scrapbooks', 'assets', 'prod-sync', runId);
    fs.mkdirSync(outDir, { recursive: true });

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    // Set demo names up-front so demo mode can auto sign-in anonymously.
    await ctxA.addInitScript(() => {
      window.localStorage.setItem('present:display_name', 'Alice');
    });
    await ctxB.addInitScript(() => {
      window.localStorage.setItem('present:display_name', 'Bob');
    });

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // User A starts at /canvas (creates a new canvas id server-side once auth completes).
    await pageA.goto('/canvas', { waitUntil: 'domcontentloaded' });
    await waitForCanvasReady(pageA);

    // Derive canvas id from URL for user B.
    const canvasId = await pageA.evaluate(() => new URL(window.location.href).searchParams.get('id'));
    expect(canvasId).toBeTruthy();

    await pageB.goto(`/canvas?id=${encodeURIComponent(String(canvasId))}`, { waitUntil: 'domcontentloaded' });
    await waitForCanvasReady(pageB);

    // Wait for LiveKit to connect (CanvasParityAutopilot with NEXT_PUBLIC_LIVEKIT_AUTO_CONNECT).
    await pageA.waitForFunction(() => (window as any).__present?.livekitConnected === true, null, { timeout: 90_000 });
    await pageB.waitForFunction(() => (window as any).__present?.livekitConnected === true, null, { timeout: 90_000 });

    // Optional: verify the LiveKit voice agent actually joins (requires Railway worker online).
    if (process.env.PLAYWRIGHT_EXPECT_AGENT === '1') {
      await pageA.waitForFunction(
        () => {
          return (window as any).__present?.livekitHasAgent === true;
        },
        null,
        { timeout: 120_000 },
      );
      await pageB.waitForFunction(
        () => {
          return (window as any).__present?.livekitHasAgent === true;
        },
        null,
        { timeout: 120_000 },
      );
    }

    // Wait for TLDraw sync to actually be online before creating shapes.
    await pageA.waitForFunction(
      () =>
        (window as any).__present?.tldrawSync?.status === 'synced-remote' &&
        (window as any).__present?.tldrawSync?.connectionStatus === 'online',
      null,
      { timeout: 90_000 },
    );
    await pageB.waitForFunction(
      () =>
        (window as any).__present?.tldrawSync?.status === 'synced-remote' &&
        (window as any).__present?.tldrawSync?.connectionStatus === 'online',
      null,
      { timeout: 90_000 },
    );

    // Create a shape on A and verify it appears on B via sync.
    const shapeId = await pageA.evaluate(() => {
      const editor = (window as any).__present?.tldrawEditor;
      const id = `shape:${crypto.randomUUID()}`;
      editor.createShape({
        id,
        type: 'geo',
        x: 160,
        y: 160,
        props: { geo: 'rectangle', w: 260, h: 120, color: 'red' },
      });
      return id;
    });

    await pageB.waitForFunction(
      (id: string) => {
        const editor = (window as any).__present?.tldrawEditor;
        if (!editor) return false;
        return !!editor.store.get(id);
      },
      shapeId,
      { timeout: 30_000 },
    );

    const shotA = path.join(outDir, 'a-canvas.png');
    const shotB = path.join(outDir, 'b-canvas.png');
    await pageA.screenshot({ path: shotA, fullPage: true });
    await pageB.screenshot({ path: shotB, fullPage: true });

    testInfo.attach('canvasA', { path: shotA, contentType: 'image/png' });
    testInfo.attach('canvasB', { path: shotB, contentType: 'image/png' });

    await ctxA.close();
    await ctxB.close();
  });
});

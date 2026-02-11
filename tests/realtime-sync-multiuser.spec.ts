import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function waitForCanvasReady(page: Page) {
  await page.waitForSelector('[data-canvas-space="true"]', { timeout: 90_000 });
  await page.waitForFunction(() => {
    return Boolean((window as any).__present?.tldrawEditor);
  }, null, { timeout: 90_000 });
}

async function waitForRealtimeHealthy(page: Page) {
  await page.waitForFunction(() => {
    const present = (window as any).__present ?? {};
    const diag = present.syncDiagnostics ?? {};
    return (
      present.livekitConnected === true &&
      diag.contract?.ok === true &&
      diag.tldraw?.ok === true &&
      diag.session?.ok === true
    );
  }, null, { timeout: 90_000 });
}

async function openSharedCanvas(
  browser: any,
): Promise<{ ctxA: BrowserContext; ctxB: BrowserContext; pageA: Page; pageB: Page; canvasId: string }> {
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

  const canvasId = await pageA.evaluate(() => {
    const id = new URL(window.location.href).searchParams.get('id');
    if (!id) {
      throw new Error('Missing canvas id in URL');
    }
    return id;
  });

  await pageB.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForCanvasReady(pageB);

  await waitForRealtimeHealthy(pageA);
  await waitForRealtimeHealthy(pageB);

  return { ctxA, ctxB, pageA, pageB, canvasId };
}

test.describe('Realtime Sync Multiuser', () => {
  test.skip(
    !process.env.REALTIME_SYNC_E2E,
    'REALTIME_SYNC_E2E=1 required (live stack + dual-user environment).',
  );

  test('shared URL converges on canonical contract/session/executor view', async ({ browser }) => {
    const { ctxA, ctxB, pageA, pageB, canvasId } = await openSharedCanvas(browser);
    try {
      const snapshotA = await pageA.evaluate(() => (window as any).__present);
      const snapshotB = await pageB.evaluate(() => (window as any).__present);

      expect(snapshotA?.syncContract?.canvasId).toBe(canvasId);
      expect(snapshotB?.syncContract?.canvasId).toBe(canvasId);
      expect(snapshotA?.syncContract?.livekitRoomName).toBe(snapshotB?.syncContract?.livekitRoomName);
      expect(snapshotA?.syncContract?.tldrawRoomId).toBe(snapshotB?.syncContract?.tldrawRoomId);
      expect(snapshotA?.sessionSync?.sessionId).toBe(snapshotB?.sessionSync?.sessionId);
      expect(snapshotA?.syncDiagnostics?.contract?.ok).toBe(true);
      expect(snapshotA?.syncDiagnostics?.session?.ok).toBe(true);
      expect(snapshotA?.syncDiagnostics?.tldraw?.ok).toBe(true);
      expect(snapshotB?.syncDiagnostics?.contract?.ok).toBe(true);
      expect(snapshotB?.syncDiagnostics?.session?.ok).toBe(true);
      expect(snapshotB?.syncDiagnostics?.tldraw?.ok).toBe(true);

      await expect
        .poll(
          async () =>
            pageA.evaluate(() => ({
              executorIdentity: (window as any).__present?.executor?.executorIdentity ?? null,
              leaseExpiresAt: (window as any).__present?.executor?.leaseExpiresAt ?? null,
            })),
          { timeout: 30_000 },
        )
        .toMatchObject({
          executorIdentity: expect.any(String),
          leaseExpiresAt: expect.any(String),
        });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('executor lease fails over after executor tab closes', async ({ browser }) => {
    const { ctxA, ctxB, pageA, pageB } = await openSharedCanvas(browser);
    try {
      const stateA = await pageA.evaluate(() => ({
        localIdentity:
          (window as any).__present?.livekitLocalIdentity ??
          (window as any).__present?.executor?.executorIdentity,
        isExecutor: Boolean((window as any).__present?.executor?.isExecutor),
      }));
      const stateB = await pageB.evaluate(() => ({
        localIdentity:
          (window as any).__present?.livekitLocalIdentity ??
          (window as any).__present?.executor?.executorIdentity,
        isExecutor: Boolean((window as any).__present?.executor?.isExecutor),
      }));

      const executorIsA = stateA.isExecutor || !stateB.isExecutor;
      if (executorIsA) {
        await ctxA.close();
        await expect
          .poll(
            async () =>
              pageB.evaluate(() => ({
                isExecutor: Boolean((window as any).__present?.executor?.isExecutor),
                executorIdentity: (window as any).__present?.executor?.executorIdentity ?? null,
              })),
            { timeout: 45_000 },
          )
          .toMatchObject({
            isExecutor: true,
            executorIdentity: expect.any(String),
          });
      } else {
        await ctxB.close();
        await expect
          .poll(
            async () =>
              pageA.evaluate(() => ({
                isExecutor: Boolean((window as any).__present?.executor?.isExecutor),
                executorIdentity: (window as any).__present?.executor?.executorIdentity ?? null,
              })),
            { timeout: 45_000 },
          )
          .toMatchObject({
            isExecutor: true,
            executorIdentity: expect.any(String),
          });
      }
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });

  test('widget state patch from user A rehydrates on user B', async ({ browser }) => {
    const { ctxA, ctxB, pageA, pageB } = await openSharedCanvas(browser);
    try {
      const messageId = `e2e-crowd-pulse-${Date.now()}`;
      const created = await pageA.evaluate(async (id) => {
        const exec = (window as any).__presentToolDispatcherExecute;
        if (typeof exec !== 'function') return false;
        await exec({
          id: `call-${id}`,
          type: 'tool_call',
          payload: {
            tool: 'create_component',
            params: {
              componentType: 'CrowdPulseWidget',
              componentProps: {
                __custom_message_id: id,
                title: 'Sync Probe',
                handCount: 0,
                peakCount: 0,
                version: 1,
                lastUpdated: Date.now(),
              },
            },
          },
          timestamp: Date.now(),
          source: 'playwright',
        });
        return true;
      }, messageId);

      expect(created).toBe(true);

      await expect
        .poll(
          async () =>
            pageB.evaluate((id) => {
              const editor = (window as any).__present?.tldrawEditor;
              if (!editor?.store?.allRecords) return false;
              const records = editor.store.allRecords();
              return records.some((record: any) => {
                if (record?.typeName !== 'shape') return false;
                const props = record?.props ?? {};
                return (
                  (props.componentType === 'CrowdPulseWidget' || props.type === 'CrowdPulseWidget') &&
                  (props.__custom_message_id === id || props.title === 'Sync Probe')
                );
              });
            }, messageId),
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('single tool_call creates one component (no duplicates)', async () => {
    test.skip(true, 'Requires deterministic tool_call publish harness from LiveKit room participant API.');
  });

  test('transcript remains shared and non-duplicated across participants', async () => {
    test.skip(true, 'Requires deterministic dual-mic or transcript fixture orchestration.');
  });
});

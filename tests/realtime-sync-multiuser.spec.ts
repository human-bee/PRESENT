import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

function transcriptShortcut() {
  return process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+K';
}

async function countMessages(page: Page, needle: string) {
  return page.evaluate((text) => {
    const panel = document.querySelector('[data-present-transcript-panel="true"]');
    if (!panel) return 0;
    const lines = Array.from(panel.querySelectorAll('div.text-sm'));
    return lines.filter((line) => (line.textContent || '').includes(text)).length;
  }, needle);
}

async function openTranscriptPanel(page: Page) {
  await page.keyboard.press(transcriptShortcut());
  await page.waitForTimeout(600);
}

async function sendTranscriptMessage(page: Page, text: string) {
  const input = page.getByLabel('Type a message for the agent');
  await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function isVoiceAgentPresent(page: Page) {
  return page.evaluate(() => {
    const present = (window as any).__present ?? {};
    if (present.livekitHasAgent === true) return true;
    const identities = Array.isArray(present.livekitRemoteParticipantIdentities)
      ? present.livekitRemoteParticipantIdentities
      : [];
    return identities.some((id: unknown) => {
      const lower = String(id ?? '').trim().toLowerCase();
      return (
        lower.startsWith('agent_') ||
        lower.startsWith('voice-agent') ||
        lower.includes('voice-agent')
      );
    });
  });
}

async function resolveRoomName(page: Page, timeoutMs = 20_000): Promise<string> {
  const handle = await page.waitForFunction(() => {
    const present = (window as any).__present ?? {};
    const roomName =
      present.livekitRoomName ??
      present.syncContract?.livekitRoomName ??
      present.sessionSync?.roomName ??
      null;
    if (typeof roomName !== 'string') return null;
    const trimmed = roomName.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, null, { timeout: timeoutMs });
  const roomName = await handle.jsonValue();
  if (typeof roomName !== 'string' || roomName.trim().length === 0) {
    throw new Error('Timed out waiting for realtime room name');
  }
  return roomName;
}

async function requestVoiceAgent(page: Page, roomName: string): Promise<void> {
  await page.evaluate(async (resolvedRoomName) => {
    await fetch('/api/agent/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: resolvedRoomName }),
    }).catch(() => {});
  }, roomName);
}

async function ensureVoiceAgentPresent(page: Page) {
  const initialHasAgent = await isVoiceAgentPresent(page);

  if (!initialHasAgent) {
    const roomName = await resolveRoomName(page, 45_000);
    const dispatchAttempts = 3;
    for (let attempt = 0; attempt < dispatchAttempts; attempt += 1) {
      if (await isVoiceAgentPresent(page)) break;
      await requestVoiceAgent(page, roomName);
      await page.waitForTimeout(1_000);
    }
  }

  await expect
    .poll(
      async () => isVoiceAgentPresent(page),
      { timeout: 45_000 },
    )
    .toBe(true);
}

async function executeToolCall(
  page: Page,
  call: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    timestamp: number;
    source: string;
    roomId?: string;
  },
) {
  await page.evaluate(
    async ({ call }) => {
      const exec = (window as any).__presentToolDispatcherExecute;
      if (typeof exec !== 'function') {
        throw new Error('Tool dispatcher not ready');
      }
      await exec(call);
    },
    { call },
  );
}

async function countShapesByMessageId(page: Page, messageId: string) {
  return page.evaluate((id) => {
    const editor = (window as any).__present?.tldrawEditor;
    if (!editor) return 0;
    const shapes: Array<Record<string, any>> = editor.getCurrentPageShapes?.() || [];
    return shapes.filter((shape) => {
      const props = shape.props || {};
      return (
        shape.type === 'custom' &&
        [props.customComponent, props.messageId, props.__custom_message_id, props.componentId].includes(id)
      );
    }).length;
  }, messageId);
}

async function waitForCanvasReady(page: Page) {
  await page.waitForSelector('[data-canvas-space="true"]', { timeout: 90_000 });
  await page.waitForFunction(() => {
    return Boolean((window as any).__present?.tldrawEditor);
  }, null, { timeout: 90_000 });
}

async function ensureLivekitConnected(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const present = (window as any).__present ?? {};
          if (present.livekitConnected === true) return true;

          const buttons = Array.from(document.querySelectorAll('button'));
          const connect = buttons.find((button) => {
            const label = (button.textContent || '').trim();
            const htmlButton = button as HTMLButtonElement;
            return (
              label === 'Connect' &&
              !htmlButton.disabled &&
              htmlButton.offsetParent !== null
            );
          }) as HTMLButtonElement | undefined;
          connect?.click();

          return Boolean((window as any).__present?.livekitConnected === true);
        }),
      { timeout: 90_000 },
    )
    .toBe(true);
}

async function waitForRealtimeHealthy(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const present = (window as any).__present ?? {};
          const diagnostics = present.syncDiagnostics ?? {};
          const roomName = present.syncContract?.livekitRoomName ?? present.livekitRoomName ?? null;
          return Boolean(
            present.livekitConnected === true &&
            diagnostics.contract?.ok === true &&
            diagnostics.session?.ok === true &&
            diagnostics.tldraw?.ok === true &&
            typeof roomName === 'string' &&
            roomName.trim().length > 0,
          );
        }),
      { timeout: 90_000 },
    )
    .toBe(true);
}

async function openSharedCanvas(
  browser: any,
): Promise<{ ctxA: BrowserContext; ctxB: BrowserContext; pageA: Page; pageB: Page; canvasId: string }> {
  const canvasId = `dev-${randomUUID()}`;
  const roomName = `canvas-${canvasId}`;
  await fetch('http://localhost:3000/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room_name: roomName,
      canvas_id: null,
      participants: [],
      transcript: [],
      canvas_state: null,
      events: [],
    }),
  }).catch(() => {});

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await ctxA.grantPermissions(['microphone', 'camera'], { origin: 'http://localhost:3000' });
  await ctxB.grantPermissions(['microphone', 'camera'], { origin: 'http://localhost:3000' });
  await ctxA.addInitScript(() => {
    window.localStorage.setItem('present:display_name', 'Alice');
  });
  await ctxB.addInitScript(() => {
    window.localStorage.setItem('present:display_name', 'Bob');
  });

  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForCanvasReady(pageA);
  await ensureLivekitConnected(pageA);

  await pageB.goto(`/canvas?id=${encodeURIComponent(canvasId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForCanvasReady(pageB);
  await ensureLivekitConnected(pageB);

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
      const snapshotA = await expect
        .poll(
          async () =>
            pageA.evaluate(() => {
              const present = (window as any).__present ?? {};
              return {
                canvasId: present.syncContract?.canvasId ?? null,
                livekitRoomName: present.syncContract?.livekitRoomName ?? null,
                tldrawRoomId: present.syncContract?.tldrawRoomId ?? null,
                sessionId: present.sessionSync?.sessionId ?? null,
                contractOk: Boolean(present.syncDiagnostics?.contract?.ok),
                sessionOk: Boolean(present.syncDiagnostics?.session?.ok),
                tldrawOk: Boolean(present.syncDiagnostics?.tldraw?.ok),
              };
            }),
          { timeout: 90_000 },
        )
        .toMatchObject({
          canvasId,
          livekitRoomName: expect.any(String),
          tldrawRoomId: expect.any(String),
          sessionId: expect.any(String),
          contractOk: true,
          sessionOk: true,
          tldrawOk: true,
        })
        .then(() =>
          pageA.evaluate(() => {
            const present = (window as any).__present ?? {};
            return {
              syncContract: present.syncContract ?? null,
              sessionSync: present.sessionSync ?? null,
              syncDiagnostics: present.syncDiagnostics ?? null,
            };
          }),
        );
      const snapshotB = await expect
        .poll(
          async () =>
            pageB.evaluate(() => {
              const present = (window as any).__present ?? {};
              return {
                canvasId: present.syncContract?.canvasId ?? null,
                livekitRoomName: present.syncContract?.livekitRoomName ?? null,
                tldrawRoomId: present.syncContract?.tldrawRoomId ?? null,
                sessionId: present.sessionSync?.sessionId ?? null,
                contractOk: Boolean(present.syncDiagnostics?.contract?.ok),
                sessionOk: Boolean(present.syncDiagnostics?.session?.ok),
                tldrawOk: Boolean(present.syncDiagnostics?.tldraw?.ok),
              };
            }),
          { timeout: 90_000 },
        )
        .toMatchObject({
          canvasId,
          livekitRoomName: expect.any(String),
          tldrawRoomId: expect.any(String),
          sessionId: expect.any(String),
          contractOk: true,
          sessionOk: true,
          tldrawOk: true,
        })
        .then(() =>
          pageB.evaluate(() => {
            const present = (window as any).__present ?? {};
            return {
              syncContract: present.syncContract ?? null,
              sessionSync: present.sessionSync ?? null,
              syncDiagnostics: present.syncDiagnostics ?? null,
            };
          }),
        );

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
      let executorTab: 'A' | 'B' | null = null;
      await expect
        .poll(
          async () => {
            const [stateA, stateB] = await Promise.all([
              pageA.evaluate(() => ({
                isExecutor: Boolean((window as any).__present?.executor?.isExecutor),
                executorIdentity: (window as any).__present?.executor?.executorIdentity ?? null,
              })),
              pageB.evaluate(() => ({
                isExecutor: Boolean((window as any).__present?.executor?.isExecutor),
                executorIdentity: (window as any).__present?.executor?.executorIdentity ?? null,
              })),
            ]);
            if (stateA.isExecutor && typeof stateA.executorIdentity === 'string') {
              executorTab = 'A';
              return true;
            }
            if (stateB.isExecutor && typeof stateB.executorIdentity === 'string') {
              executorTab = 'B';
              return true;
            }
            return false;
          },
          { timeout: 45_000 },
        )
        .toBe(true);

      if (executorTab === 'A') {
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
      } else if (executorTab === 'B') {
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
      } else {
        throw new Error('Executor tab did not resolve before failover check');
      }
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });

  test('widget state patch from user A rehydrates on user B', async ({ browser }) => {
    const { ctxA, ctxB, pageA, pageB } = await openSharedCanvas(browser);
    try {
      const executorTab = await expect
        .poll(
          async () => {
            const [aIsExecutor, bIsExecutor] = await Promise.all([
              pageA.evaluate(() => Boolean((window as any).__present?.executor?.isExecutor)),
              pageB.evaluate(() => Boolean((window as any).__present?.executor?.isExecutor)),
            ]);
            if (aIsExecutor) return 'A';
            if (bIsExecutor) return 'B';
            return null;
          },
          { timeout: 45_000 },
        )
        .toBeTruthy()
        .then(async () => {
          const aIsExecutor = await pageA.evaluate(() => Boolean((window as any).__present?.executor?.isExecutor));
          return aIsExecutor ? 'A' : 'B';
        });

      const sourcePage = executorTab === 'A' ? pageA : pageB;
      const observerPage = executorTab === 'A' ? pageB : pageA;
      const messageId = `e2e-crowd-pulse-${Date.now()}`;
      const created = await sourcePage.evaluate(async (id) => {
        const exec = (window as any).__presentToolDispatcherExecute;
        if (typeof exec !== 'function') return false;
        await exec({
          id: `call-${id}`,
          type: 'tool_call',
          payload: {
            tool: 'create_component',
            params: {
              type: 'CrowdPulseWidget',
              messageId: id,
              props: {
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
          async () => (await observerPage.getByText('Sync Probe', { exact: true }).count()) > 0,
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('single tool_call creates one component (no duplicates)', async ({ browser }) => {
    const { ctxA, ctxB, pageA, pageB } = await openSharedCanvas(browser);
    try {
      const base = `dup-tool-${Date.now()}`;
      const sharedCallId = `realtime-tool-${base}`;
      const messageId = `message-${base}`;
      const call = {
        id: sharedCallId,
        type: 'tool_call',
        payload: {
          tool: 'create_component',
          params: {
            type: 'CrowdPulseWidget',
            messageId,
            props: {
              __custom_message_id: messageId,
              title: 'No Duplicate Probe',
              handCount: 0,
              peakCount: 0,
              version: 1,
              lastUpdated: Date.now(),
            },
          },
        },
        timestamp: Date.now(),
        source: 'playwright',
      };

      await executeToolCall(pageA, call);
      await expect
        .poll(async () => countShapesByMessageId(pageA, messageId), { timeout: 30_000 })
        .toBe(1);
      await expect
        .poll(async () => countShapesByMessageId(pageB, messageId), { timeout: 30_000 })
        .toBe(1);

      await executeToolCall(pageA, call);
      await expect
        .poll(async () => countShapesByMessageId(pageA, messageId), { timeout: 30_000 })
        .toBe(1);
      await expect
        .poll(async () => countShapesByMessageId(pageB, messageId), { timeout: 30_000 })
        .toBe(1);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('transcript remains shared and non-duplicated across participants', async ({ browser }) => {
    const { ctxA, ctxB, pageA, pageB } = await openSharedCanvas(browser);
    try {
      await openTranscriptPanel(pageA);
      await openTranscriptPanel(pageB);
      await Promise.all([ensureVoiceAgentPresent(pageA), ensureVoiceAgentPresent(pageB)]);

      const now = Date.now();
      const aliceLine = `Alice probe ${now}`;
      const bobLine = `Bob probe ${now}`;

      await sendTranscriptMessage(pageA, aliceLine);
      await expect
        .poll(async () => countMessages(pageA, aliceLine), { timeout: 30_000 })
        .toBe(1);
      await expect
        .poll(async () => countMessages(pageB, aliceLine), { timeout: 30_000 })
        .toBe(1);

      await sendTranscriptMessage(pageB, bobLine);
      await expect
        .poll(async () => countMessages(pageA, bobLine), { timeout: 30_000 })
        .toBe(1);
      await expect
        .poll(async () => countMessages(pageB, bobLine), { timeout: 30_000 })
        .toBe(1);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});

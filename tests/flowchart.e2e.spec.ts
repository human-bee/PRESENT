import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

const randomId = Math.random().toString(36).slice(2, 8);
const TEST_EMAIL = `playwright+${Date.now()}_${randomId}@present.local`;
const TEST_PASSWORD = 'Devtools123!';

async function ensureConnected(page) {
  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.getByLabel('Name').fill('Playwright Bot');
  await page.getByLabel('Email').fill(TEST_EMAIL);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/canvas**', { timeout: 20000 });

  const connectButton = page.getByRole('button', { name: 'Connect' });
  await expect(connectButton).toBeVisible({ timeout: 20000 });
  await connectButton.scrollIntoViewIfNeeded();
  await connectButton.evaluate((el: HTMLElement) => el.click());
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20000 });
}

test('steward commit applies mermaid patch via LiveKit broadcast', async ({ page, context }) => {
  test.setTimeout(120000);
  await context.grantPermissions(['microphone', 'camera'], { origin: BASE_URL });
  await page.setViewportSize({ width: 1400, height: 1800 });
  page.on('console', (msg) => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  await ensureConnected(page);

  const shapeId = await page.evaluate(async () => {
    const g: any = window;
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const editor = g?.__present?.tldrawEditor;
      if (!editor) continue;
      if (editor.getShapeUtil?.('mermaid_stream') && !g.__present_mermaid_creating) {
        window.dispatchEvent(
          new CustomEvent('tldraw:create_mermaid_stream', { detail: { text: 'graph TD;\nA-->B;' } }),
        );
      }
      const shapes = editor.getCurrentPageShapes?.() || [];
      const mermaid = shapes.find((s: any) => s?.type === 'mermaid_stream');
      if (mermaid) {
        g.__present_mermaid_last_shape_id = mermaid.id;
        return mermaid.id as string;
      }
    }
    return null;
  });

  expect(shapeId).not.toBeNull();

  const doc = `graph TD\n  Start[Wake up] --> Coffee[Brew coffee]\n  Coffee --> Emails[Answer emails]\n  Emails --> Standup[Team standup]`;
  console.log('present keys', await page.evaluate(() => Object.keys((window as any).__present || {})));

  const commitResult = await page.evaluate(async ({ docText }) => {
    const g: any = window;
    const componentId = g?.__present_mermaid_last_shape_id;
    if (!componentId) return { status: 0, text: 'missing componentId' };
    const params = new URLSearchParams(window.location.search);
    const canvasId = params.get('id');
    const roomName =
      g?.__present?.livekitRoomName || g?.__present_roomName || g?.__present_canvas_room || (canvasId ? `canvas-${canvasId}` : null);
    if (!roomName) {
      return { status: 0, text: 'missing room name' };
    }
    const res = await fetch('/api/steward/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: roomName,
        componentId,
        flowchartDoc: docText,
        format: 'mermaid',
        version: 1,
      }),
    });
    const text = await res.text();
    return { status: res.status, text };
  }, { docText: doc });

  console.log('commitResult', commitResult);
  expect(commitResult.status).toBe(200);

  const mermaidTextHandle = await page.waitForFunction(() => {
    const g: any = window;
    const editor = g?.__present?.tldrawEditor;
    const shapeId = g?.__present_mermaid_last_shape_id;
    if (!editor || !shapeId) return null;
    const shape = editor.getShape?.(shapeId);
    return shape?.props?.mermaidText || null;
  }, {}, { timeout: 60000 });

  const mermaidText = await mermaidTextHandle.jsonValue();
  console.log('Final mermaid document:\n', mermaidText);
  expect(mermaidText).toContain('Wake up');
  expect(mermaidText).toContain('Standup');
});

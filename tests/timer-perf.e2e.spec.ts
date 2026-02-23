import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'Devtools123!';

function isMac(): boolean {
  return process.platform === 'darwin';
}

async function signUp(page: any) {
  const email = `timer+${Date.now()}_${Math.random().toString(36).slice(2, 6)}@present.local`;
  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.getByLabel('Name').fill('Playwright Timer Perf');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/canvas**', { timeout: 20_000 });
  return email;
}

async function connectRoom(page: any) {
  const modifier = isMac() ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.waitForTimeout(500);
  const connectButton = page.getByRole('button', { name: /connect/i }).first();
  await connectButton.waitFor({ state: 'visible', timeout: 15_000 });
  await connectButton.evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  await page.getByRole('button', { name: 'Disconnect' }).waitFor({ timeout: 20_000 });
}

async function ensureToolDispatcherReady(page: any) {
  await page.waitForFunction(
    () => typeof (window as any).__presentToolDispatcherExecute === 'function',
    null,
    { timeout: 10_000 },
  );
}

async function invokeToolWithMetrics(page: any, call: any, timeoutMs = 5_000) {
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
          reject(
            new Error(
              `Timed out waiting for metrics for ${call.payload?.tool || 'unknown tool'}`,
            ),
          );
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

const percentile = (sorted: number[], value: number): number => {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1));
  return sorted[rank];
};

test.describe('Timer send → paint latency', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__presentDispatcherMetrics = true;
      (window as any).__presentToolMetricsLog = [];
      window.addEventListener('present:tool_metrics', (event) => {
        (window as any).__presentToolMetricsLog.push(event.detail);
      });
    });
  });

  test('create and update timer stay within latency budget', async ({ page }) => {
    await signUp(page);
    await connectRoom(page);
    await ensureToolDispatcherReady(page);

    const timerId = `ui-playwright-${Date.now().toString(36)}`;

    const createMetrics: any = await invokeToolWithMetrics(page, {
      id: `create-${Date.now()}`,
      type: 'tool_call',
      payload: {
        tool: 'create_component',
        params: {
          type: 'RetroTimerEnhanced',
          messageId: timerId,
          spec: { initialMinutes: 5 },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });

    expect(createMetrics).toBeTruthy();
    expect(typeof createMetrics.dtPaintMs).toBe('number');
    expect(createMetrics.dtPaintMs).toBeLessThan(1500);

    await page.waitForTimeout(300);
    await expect(page.getByText('05:00').first()).toBeVisible({ timeout: 5000 });

    const updateMetrics: any = await invokeToolWithMetrics(page, {
      id: `update-${Date.now()}`,
      type: 'tool_call',
      payload: {
        tool: 'update_component',
        params: {
          componentId: timerId,
          patch: { duration: 420 },
        },
      },
      timestamp: Date.now(),
      source: 'playwright',
    });

    expect(updateMetrics).toBeTruthy();
    expect(typeof updateMetrics.dtPaintMs).toBe('number');
    expect(updateMetrics.dtPaintMs).toBeLessThan(1500);

    const samples = [createMetrics.dtPaintMs, updateMetrics.dtPaintMs]
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b);
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const summary = {
      sampledAt: new Date().toISOString(),
      sampleCount: samples.length,
      p50Ms: p50,
      p95Ms: p95,
      samples,
    };

    const metricsPath =
      process.env.PLAYWRIGHT_LATENCY_METRICS_FILE || 'artifacts/latency/deterministic-lane.json';
    await mkdir(dirname(metricsPath), { recursive: true });
    await writeFile(metricsPath, JSON.stringify(summary, null, 2), 'utf8');

    if (process.env.CI_LATENCY_SOFT_GATE === 'true') {
      expect(p95).toBeLessThanOrEqual(800);
    } else {
      expect(p95).toBeLessThan(1500);
    }

    await page.waitForTimeout(300);
    await expect(page.getByText('07:00').first()).toBeVisible({ timeout: 5000 });
  });
});

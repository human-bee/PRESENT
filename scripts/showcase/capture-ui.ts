import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), 'public', 'showcase', '2026-ui');
const RUN_ID = process.env.SHOWCASE_RUN_ID || new Date().toISOString().slice(0, 10);

type ThemeMode = 'light' | 'dark';
type ViewportName = 'desktop' | 'mobile';

const viewports: Array<{ name: ViewportName; width: number; height: number }> = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function setTheme(page: Page, theme: ThemeMode) {
  await page.addInitScript((t: ThemeMode) => {
    window.localStorage.setItem('present:theme', t);
    // Ensure config pages don't crash on invalid persisted JSON from prior dev sessions.
    window.localStorage.setItem('mcp-servers', '[]');
  }, theme);
}

function isRetryableNavigationError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('net::ERR_ABORTED') ||
    msg.includes('Navigation') ||
    msg.includes('Target closed') ||
    msg.includes('Page closed')
  );
}

async function gotoAndWait(
  page: Page,
  pathname: string,
  waitForSelector: string,
  opts?: { waitUntil?: 'domcontentloaded' | 'load'; retries?: number },
) {
  const url = `${BASE_URL}${pathname}`;
  const waitUntil = opts?.waitUntil ?? 'domcontentloaded';
  const retries = opts?.retries ?? 3;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil, timeout: 60_000 });
      await page.waitForSelector(waitForSelector, { state: 'visible', timeout: 60_000 });
      // Small settle to avoid capturing mid-hydration.
      await page.waitForTimeout(150);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryableNavigationError(err)) {
        await page.waitForTimeout(400 * attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

async function screenshot(page: Page, name: string) {
  const datedPath = path.join(OUT_DIR, `${RUN_ID}-${name}.png`);
  const latestPath = path.join(OUT_DIR, `latest-${name}.png`);
  await page.screenshot({ path: datedPath, fullPage: true });
  await page.screenshot({ path: latestPath, fullPage: true });
}

async function captureCanvas(page: Page, theme: ThemeMode, viewport: ViewportName) {
  await gotoAndWait(page, '/canvas', '.tl-container');
  await screenshot(page, `canvas-${theme}-${viewport}-closed`);

  // Transcript open via Ctrl+K (matches existing UX + tests).
  await page.keyboard.press('Control+K');
  await page.waitForSelector('[data-present-transcript-panel="true"][data-state="open"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await screenshot(page, `canvas-${theme}-${viewport}-chat`);
}

async function main() {
  ensureDir(OUT_DIR);

  const browser = await chromium.launch();
  try {
    for (const { name: viewportName, width, height } of viewports) {
      for (const theme of ['light', 'dark'] as const) {
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();

        await setTheme(page, theme);

        await captureCanvas(page, theme, viewportName);

        await gotoAndWait(page, '/showcase/ui', '[data-present-showcase-mounted="true"]');
        await screenshot(page, `ui-${theme}-${viewportName}`);

        await gotoAndWait(page, '/mcp-config', 'text=MCP server configuration', { waitUntil: 'load' });
        await screenshot(page, `mcp-config-${theme}-${viewportName}`);

        await gotoAndWait(page, '/auth/signin', 'text=Sign In');
        await screenshot(page, `signin-${theme}-${viewportName}`);

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

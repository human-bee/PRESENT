import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), 'public', 'showcase', '2026-ui');

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
  }, theme);
}

async function gotoAndWait(page: Page, pathname: string, waitForSelector: string) {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(waitForSelector, { state: 'visible', timeout: 60_000 });
}

async function screenshot(page: Page, name: string) {
  const outPath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
}

async function captureCanvas(page: Page, theme: ThemeMode, viewport: ViewportName) {
  await gotoAndWait(page, '/canvas', '.tl-container');
  await screenshot(page, `canvas-${theme}-${viewport}-closed`);

  // Transcript open via Ctrl+K (matches existing UX + tests).
  await page.keyboard.press('Control+K');
  await page.waitForSelector('[data-debug-source="messaging-message-form"]', {
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

        await gotoAndWait(page, '/showcase/ui', 'text=UI Showcase');
        await screenshot(page, `ui-${theme}-${viewportName}`);

        await gotoAndWait(page, '/mcp-config', 'text=MCP server configuration');
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

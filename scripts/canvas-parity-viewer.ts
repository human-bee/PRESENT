#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const getArg = (key: string) => {
  const prefix = `--${key}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return null;
};

const url = getArg('url');
if (!url) {
  console.error('[canvas-parity-viewer] Missing --url argument.');
  process.exit(1);
}

const durationMs = Number(getArg('duration') ?? '45000');
const readyTimeout = Number(getArg('timeout') ?? '25000');
const headless = process.env.PARITY_VIEWER_HEADLESS !== '0';
const screenshotPath = getArg('screenshot');
const screenshotWait = Number(getArg('screenshot-wait') ?? '0');

async function run() {
  const browser = await chromium.launch({ headless });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    console.log(`[canvas-parity-viewer] opening ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: readyTimeout });
    await page.waitForTimeout(durationMs);
    if (screenshotWait > 0) {
      await page.waitForTimeout(screenshotWait);
    }
    if (screenshotPath) {
      const resolved = path.resolve(screenshotPath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await page.screenshot({ path: resolved, fullPage: true });
      console.log(`[canvas-parity-viewer] saved screenshot to ${resolved}`);
    }
    console.log('[canvas-parity-viewer] duration elapsed, closing viewer');
    await browser.close();
  } catch (error) {
    console.error('[canvas-parity-viewer] failed', error);
    await browser.close();
    process.exit(1);
  }
}

run();

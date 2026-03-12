import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { IMAGE_MODELS, type ImageModelId } from '@/lib/ai/image-models';

const BASE_URL = process.env.SHOWCASE_BASE_URL || 'http://127.0.0.1:3000';
const PROMPT =
  process.env.SHOWCASE_PROMPT || 'A cinematic brass robot sketching posters in a sunlit studio';
const OUTPUT_ROOT = path.join(
  process.cwd(),
  'output',
  'playwright',
  'ai-image-generator-showcase',
  new Date().toISOString().replaceAll(':', '-').replace(/\..+/, 'Z'),
);

const SCREENSHOT_MODELS: ImageModelId[] = [
  'google-nano-banana-2',
  'xai-grok-imagine-image',
  'openai-gpt-image-1_5-high',
  'fal-flux-2-dev-flash',
];

function uniqueCanvasId(suffix: string) {
  return `ai-image-${suffix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function waitForCanvasReady(page: Page) {
  await page.goto(`${BASE_URL}/canvas?id=${uniqueCanvasId('canvas')}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByText('TLDraw Conn: online').waitFor({ timeout: 30_000 });
}

async function mountWidget(page: Page, model: ImageModelId) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/generateImages') &&
      response.request().method() === 'POST' &&
      response.status() === 200,
    { timeout: 120_000 },
  );
  await page.evaluate(
    ({ prompt, modelId }) => {
      window.dispatchEvent(
        new CustomEvent('custom:showComponent', {
          detail: {
            messageId: 'ai-image-showcase-widget',
            component: {
              type: 'AIImageGenerator',
              props: {
                prompt,
                autoDropToCanvas: true,
                model: modelId,
              },
            },
            lifecycleAction: 'create',
          },
        }),
      );
    },
    { prompt: PROMPT, modelId: model },
  );
  await page.getByText('Image Draft').waitFor({ timeout: 15_000 });
  await responsePromise;
  await page
    .locator('img[alt="A cinematic brass robot sketching posters in a sunlit studio"]')
    .first()
    .waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
}

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1220 } });
  const page = await context.newPage();
  const screenshots: Array<{ modelId: ImageModelId; file: string }> = [];

  for (const model of SCREENSHOT_MODELS) {
    await waitForCanvasReady(page);
    await mountWidget(page, model);
    const file = path.join(OUTPUT_ROOT, `${model}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push({ modelId: model, file });
  }

  await context.close();
  await browser.close();
  return screenshots;
}

async function captureMenuVideo() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1220 },
    recordVideo: {
      dir: OUTPUT_ROOT,
      size: { width: 1440, height: 1220 },
    },
  });
  const page = await context.newPage();
  await waitForCanvasReady(page);
  await mountWidget(page, 'google-nano-banana-2');

  await page.evaluate(() => {
    const details = document.querySelector('details');
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
    }
  });
  const menu = page.locator('details[open]').first();
  await menu.waitFor({ timeout: 15_000 });
  await menu.locator('select').first().selectOption('16:9');
  await menu.locator('select').nth(1).selectOption('4k');
  await page.getByRole('button', { name: /OpenAI pro GPT Image 1.5/i }).click({ force: true });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/generateImages') &&
      response.request().method() === 'POST' &&
      response.status() === 200,
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: /^Generate$/ }).click();
  await responsePromise;
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const details = document.querySelector('details');
    if (details instanceof HTMLDetailsElement) {
      details.open = false;
    }
  });
  await page.waitForTimeout(1000);

  const pageHandle = await page.video();
  await context.close();
  await browser.close();
  if (!pageHandle) {
    throw new Error('video_not_recorded');
  }
  const videoPath = await pageHandle.path();
  const targetPath = path.join(OUTPUT_ROOT, 'ai-image-generator-config-menu.webm');
  fs.copyFileSync(videoPath, targetPath);
  return targetPath;
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const screenshots = process.env.SHOWCASE_VIDEO_ONLY === '1' ? [] : await captureScreenshots();
  const video = await captureMenuVideo();
  const summary = {
    prompt: PROMPT,
    baseUrl: BASE_URL,
    screenshots,
    video,
    models: SCREENSHOT_MODELS.map((modelId) => {
      const model = IMAGE_MODELS.find((entry) => entry.id === modelId);
      return {
        id: modelId,
        label: model?.label ?? modelId,
        provider: model?.provider ?? 'unknown',
      };
    }),
  };
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, request, type Page } from 'playwright';

const BASE_URL = 'http://127.0.0.1:3000';
const OUTPUT_ROOT = path.join(process.cwd(), 'output/playwright/infographic-widget-showcase');
const MODELS = [
  'google-nano-banana-2',
  'xai-grok-imagine-image',
  'openai-gpt-image-1_5-high',
  'fal-flux-2-dev-flash',
] as const;

const CONTEXT_DOCUMENTS = [
  {
    id: 'debate-brief',
    title: 'Debate Recap',
    type: 'markdown',
    content: [
      '# Debate Recap',
      '',
      'AFF argued that local climate adaptation spending returns measurable gains within one budget cycle.',
      'NEG argued that the plan overstates municipal capacity and underestimates maintenance debt.',
      'Judge lean: slight AFF because the evidence chain was clearer and the delivery was more disciplined.',
      'Key evidence: AFF used city pilot numbers; NEG used long-tail maintenance risk and staffing constraints.',
      'Desired output: one crisp infographic poster with headline, verdict, best AFF case, best NEG case, and a timeline.',
    ].join('\n'),
  },
];

async function ensureOutputDir() {
  const dir = path.join(OUTPUT_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function seedContext(page: Page, sessionId: string) {
  const api = await request.newContext({ baseURL: BASE_URL });
  try {
    const response = await api.post('/api/session/context', {
      data: {
        sessionId,
        contextDocuments: CONTEXT_DOCUMENTS,
      },
    });
    if (!response.ok()) {
      throw new Error(`failed_to_seed_context:${response.status()}`);
    }
  } finally {
    await api.dispose();
  }
}

async function waitForCanvas(page: Page, canvasId: string) {
  await page.goto(`${BASE_URL}/canvas?id=${canvasId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('TLDraw Conn: online'),
    {},
    { timeout: 60000 },
  );
}

async function mountWidget(
  page: Page,
  model: (typeof MODELS)[number],
  messageId: string,
  contextKey: string,
) {
  await page.evaluate(
    ({ messageId, model, contextKey }) => {
      window.dispatchEvent(
        new CustomEvent('custom:showComponent', {
          detail: {
            messageId,
            lifecycleAction: 'create',
            component: {
              type: 'InfographicWidget',
              props: {
                messageId,
                contextKey,
                isShape: true,
                direction: 'Make it feel like a front-page debate briefing with a decisive verdict and evidence split.',
                style: 'news-desk',
                model,
                aspectRatio: '4:5',
                resolution: 'sd',
                useGrounding: false,
              },
            },
            contextKey,
          },
        }),
      );
    },
    { messageId, model, contextKey },
  );

  await page.getByRole('button', { name: /generate|regenerate/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function generate(page: Page) {
  await page.getByRole('button', { name: /generate|regenerate/i }).click();
  const winner = await Promise.race([
    page.waitForSelector('img[alt="Generated infographic"]', { timeout: 120000 }).then(
      () => 'image' as const,
    ),
    page
      .getByText(
        /Add a .* key|not configured on this environment yet|Infographic generation failed|_image_error|missing_payload/i,
      )
      .waitFor({ timeout: 120000 })
      .then(() => 'error' as const),
  ]);
  await page.waitForTimeout(1500);
  return winner;
}

async function captureScreenshots(outputDir: string) {
  const browser = await chromium.launch({ headless: true });
  const results: Array<{ model: (typeof MODELS)[number]; file: string; outcome: 'image' | 'error' }> = [];
  try {
    for (const model of MODELS) {
      const context = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
      const page = await context.newPage();
      const canvasId = `infographic-canvas-${model}-${Date.now().toString(36)}`;
      const messageId = `infographic-${model}`;

      await seedContext(page, canvasId);
      await waitForCanvas(page, canvasId);
      await mountWidget(page, model, messageId, canvasId);
      const outcome = await generate(page);

      const file = path.join(outputDir, `${model}.png`);

      await page.screenshot({
        path: file,
        fullPage: true,
      });
      results.push({ model, file, outcome });
      if (outcome !== 'image') {
        throw new Error(`model_generation_failed:${model}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function captureVideo(outputDir: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1300 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1500, height: 1300 },
    },
  });
  const page = await context.newPage();
  const canvasId = `infographic-video-${Date.now().toString(36)}`;
  const messageId = 'infographic-video-widget';

  try {
    await seedContext(page, canvasId);
    await waitForCanvas(page, canvasId);
    await mountWidget(page, 'openai-gpt-image-1_5-high', messageId, canvasId);

    await page.getByText('Manifesto').click();
    await generate(page);
    await page.waitForTimeout(1000);

    await page.locator('details').first().evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });
    await page.waitForTimeout(500);
    const controls = page.locator('details[open] select');
    await controls.nth(0).selectOption('16:9');
    await page.waitForTimeout(400);
    await controls.nth(1).selectOption('hd');
    await page.waitForTimeout(400);
    const qualitySelect = controls.nth(2);
    if ((await qualitySelect.count()) > 0) {
      await qualitySelect.selectOption('high');
      await page.waitForTimeout(400);
    }
    await page.locator('details').first().evaluate((node) => {
      (node as HTMLDetailsElement).open = false;
    });
    await page.waitForTimeout(700);
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const tempPath = await video.path();
      await rename(tempPath, path.join(outputDir, 'infographic-widget-config-menu.webm'));
    }
    await browser.close();
  }
}

async function main() {
  const outputDir = await ensureOutputDir();
  const screenshots = await captureScreenshots(outputDir);
  await captureVideo(outputDir);

  const summary = {
    baseUrl: BASE_URL,
    outputDir,
    models: MODELS,
    allSucceeded: screenshots.every((entry) => entry.outcome === 'image'),
    screenshots,
    video: path.join(outputDir, 'infographic-widget-config-menu.webm'),
  };

  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

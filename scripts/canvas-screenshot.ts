import { chromium } from 'playwright';

async function main() {
  const roomId = process.argv[2];
  const outPath = process.argv[3] || `canvas-${Date.now()}.png`;
  if (!roomId) {
    console.error('Usage: tsx scripts/canvas-screenshot.ts <roomId> [outputPath]');
    process.exit(1);
  }

  const url = `http://localhost:3000/canvas?id=${roomId}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(url, { waitUntil: 'load' });

  try {
    const connectButton = page.getByRole('button', { name: 'Connect' });
    await connectButton.waitFor({ state: 'visible', timeout: 5000 });
    await connectButton.click();
  } catch {}

  await page.waitForTimeout(2000);
  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

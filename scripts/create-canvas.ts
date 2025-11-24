import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const freshUrl = `http://localhost:3000/canvas?fresh=1&ts=${Date.now()}`;
  await page.goto(freshUrl, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  const finalUrl = page.url();
  await browser.close();
  const roomMatch = finalUrl.match(/id=([^&]+)/);
  if (!roomMatch) {
    console.error('Failed to derive canvas room id from URL:', finalUrl);
    process.exit(1);
  }
  console.log(roomMatch[1]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

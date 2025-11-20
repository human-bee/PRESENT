const { chromium } = require('./node_modules/@playwright/test');
const url = process.argv[2];
const dwell = Number(process.argv[3] || 90000);
(async()=>{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /connect/i.test((b.textContent||'')));
    if (btn) btn.click();
  });
  await page.waitForTimeout(6000);
  const logState = async (label) => {
    const res = await page.evaluate(() => {
      const editor = window.__present?.tldrawEditor;
      const save = window.__presentManualCanvasSave;
      return {
        label,
        shapes: editor ? editor.getCurrentPageShapes().length : null,
        hasSave: !!save,
      };
    });
    console.log(res);
  };
  await logState('after-connect');
  const interval = setInterval(async () => {
    try {
      await page.evaluate(async () => {
        const save = window.__presentManualCanvasSave;
        if (save) await save();
      });
      await logState('autosave');
    } catch (err) {
      console.error('autosave err', err);
    }
  }, 12000);
  await page.waitForTimeout(dwell);
  clearInterval(interval);
  await logState('end');
  await browser.close();
})();

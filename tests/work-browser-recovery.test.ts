import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test';
import { fixture, stateOf, until } from './fixtures/work-process-harness';

test('signed browser reload presents explicit Resume after real SIGKILL and completes the same controlled turn', { timeout: 60000, skip: process.env.PRESENT_RECOVERY_BROWSER !== '1' }, async () => {
  const f = await fixture(4454);
  let browser: Browser | undefined, context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || undefined });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addCookies([{ name: f.owner.cookie.split('=')[0], value: f.owner.cookie.split('=').slice(1).join('='), url: f.origin }]);
    const job = await f.startJob(f.owner, 'browser-visible-resume', 'controlled');
    await until(() => f.saved(job.jobId), value => value.executionState?.phase === 'running', 'durable original turn');
    const before = f.saved(job.jobId);
    await until(() => { try { return readFileSync(join(f.root, 'tldraw', `${f.roomId}.json`), 'utf8'); } catch { return ''; } }, text => text.includes(job.objectId), 'durable original card');
    await page.goto(`${f.origin}/r/${f.roomId}`);
    // Work cards are sections with an accessible label, regardless of browser role mapping.
    const visibleCard = page.locator('section[aria-label="Work card"]');
    await expect(visibleCard.getByRole('status')).toHaveText('running');
    await f.stop('SIGKILL'); await f.start(); await page.reload();
    await expect(visibleCard.getByRole('status')).toHaveText('interrupted');
    await expect(visibleCard.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(visibleCard.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    const canonicalCard = (await f.objects(f.owner, f.roomId)).find(object => object.id === job.objectId)!;
    assert.equal((canonicalCard.data.work as { status: string }).status, 'interrupted');
    assert.equal(f.events().filter(event => event.method === 'turn/start').length, 1, 'browser refresh never replays work');
    const evidence = process.env.PRESENT_RECOVERY_EVIDENCE_DIRECTORY;
    if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'browser-interrupted-resume.png') }); }
    f.release(job.jobId);
    await visibleCard.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(visibleCard.getByRole('status')).toHaveText('completed');
    await expect(visibleCard.getByRole('button', { name: 'Open artifact', exact: true })).toBeEnabled();
    for (const key of ['workspaceId', 'threadId', 'turnId', 'dispatchId', 'model'] as const) assert.equal(stateOf(f.saved(job.jobId))[key], stateOf(before)[key]);
    assert.equal(f.events().filter(event => event.method === 'turn/start').length, 1, 'Resume joins the exact existing turn');
    assert.equal(errors.length, 0, errors.join('\n'));
    if (evidence) await page.screenshot({ path: join(evidence, 'browser-completed-artifact.png') });
  } finally { await context?.close(); await browser?.close(); await f.close(); }
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test';

for (const [index, planningOnly] of [false, true].entries()) {
  test(`real signed HTTP/browser reports ${planningOnly ? 'API planning without workspace support' : 'controlled Codex account/catalog'} and Sol default without a turn`, { timeout: 45000, skip: process.env.PRESENT_LAUNCH_BROWSER !== '1' }, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-launch-capability-'))), home = join(root, 'controlled-codex'); mkdirSync(home);
    writeFileSync(join(home, 'CONTROLLED_TEST_ONLY'), 'read-only discovery fixture');
    if (!planningOnly) writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
    const origin = `http://127.0.0.1:${4455 + index}`;
    const child = spawn(process.execPath, ['--import', 'tsx', ...(planningOnly ? ['--import', resolve('tests/fixtures/planning-only-openai.mjs')] : []), 'server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, NODE_ENV: 'production', PRESENT_HOST: '127.0.0.1', PRESENT_PORT: String(4455 + index), PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: origin, PRESENT_ACCESS_SECRET: randomBytes(32).toString('hex'), PRESENT_ACCESS_DIRECTORY: join(root, 'access'), PRESENT_DATA_DIRECTORY: root, PRESENT_ENV_FILE: join(root, 'absent.env'),
      CODEX_HOME: home, CODEX_CLI_PATH: planningOnly ? join(root, 'absent-codex') : resolve('tests/fixtures/controlled-work-codex.mjs'), PRESENT_MODEL_TRANSPORT: planningOnly ? 'openai' : 'codex', OPENAI_API_KEY: planningOnly ? 'CONTROLLED_NOT_A_REAL_KEY' : '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPSESAFE_AI_API: '', LIVEKIT_URL: '', NEXT_PUBLIC_LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', LINEAR_API_KEY: '', YOUTUBE_API_KEY: '',
    } });
    let output = '', browser: Browser | undefined, context: BrowserContext | undefined;
    child.stdout.on('data', bytes => { output += String(bytes); }); child.stderr.on('data', bytes => { output += String(bytes); });
    try {
      for (let attempt = 0; !output.includes(`PRESENT is ready at ${origin}`); attempt++) {
        if (attempt > 200 || child.exitCode !== null) throw new Error(`Isolated server did not start: ${output.slice(-2000)}`); await pause(25);
      }
      assert.equal((await fetch(`${origin}/api/agents`)).status, 401);
      const session = await fetch(`${origin}/api/access/session`, { method: 'POST', headers: { origin } }); assert.equal(session.status, 201);
      const cookie = session.headers.get('set-cookie'); assert.ok(cookie);
      const room = await fetch(`${origin}/api/access/rooms`, { method: 'POST', headers: { origin, cookie } }); assert.equal(room.status, 201);
      const { roomId } = await room.json();
      const capabilities = await (await fetch(`${origin}/api/agents`, { headers: { cookie } })).json();
      assert.equal(capabilities.defaultProvider, 'sol'); assert.deepEqual(capabilities.providers.slice(0, 3).map((provider: { model: string }) => provider.model), ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra']);
      assert.equal(capabilities.planning.catalogVerified, true); assert.equal(capabilities.planning.generationVerified, false);
      assert.equal(capabilities.workspace.supported, !planningOnly); assert.equal(capabilities.workspace.authenticated, !planningOnly); assert.equal(capabilities.workspace.executionVerified, false);
      browser = await chromium.launch({ headless: true, channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || undefined }); context = await browser.newContext();
      await context.addCookies([{ name: 'present_session', value: cookie.split(';')[0].slice('present_session='.length), url: origin }]);
      const page = await context.newPage(); await page.goto(`${origin}/r/${roomId}`);
      const browserCapabilities = await page.evaluate(async () => (await fetch('/api/agents')).json());
      assert.deepEqual(browserCapabilities, capabilities);
      await page.getByRole('button', { name: 'Room settings', exact: true }).click();
      await expect(page.getByLabel('Who’s making things?')).toHaveValue('sol');
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await page.getByRole('button', { name: 'Add to room', exact: true }).click();
      await page.getByRole('button', { name: 'A commitment Assign it, start work, keep the result', exact: true }).click();
      const card = page.locator('section[aria-label="Work card"]');
      await card.getByLabel('Work request', { exact: true }).fill('Prepare a tested controlled work receipt.');
      const start = card.getByRole('button', { name: 'Start work', exact: true });
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeVisible();
      if (planningOnly) {
        await expect(start).toBeDisabled();
        await expect(card.getByText(capabilities.workspace.reason, { exact: true })).toBeVisible();
        assert.match(capabilities.workspace.reason, /Codex app-server.*ChatGPT sign-in.*API planning key does not provide it/);
      } else await expect(start).toBeEnabled();
      const evidence = process.env.PRESENT_LAUNCH_EVIDENCE_DIRECTORY;
      if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, `capabilities-${planningOnly ? 'planning-only' : 'codex'}.json`), JSON.stringify(capabilities, null, 2)); await page.screenshot({ path: join(evidence, `browser-${planningOnly ? 'planning-only' : 'codex'}.png`) }); }
      const events = existsSync(join(home, 'events.jsonl')) ? readFileSync(join(home, 'events.jsonl'), 'utf8') : '';
      assert.equal(events.includes('thread/start'), false); assert.equal(events.includes('turn/start'), false);
      assert.equal(events.split('\n').filter(line => line.includes('process-start')).length, planningOnly ? 0 : 1, 'cached API/browser reads share one discovery probe');
    } finally {
      await context?.close(); await browser?.close();
      if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
      rmSync(root, { recursive: true, force: true });
    }
  });
}

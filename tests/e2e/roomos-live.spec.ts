import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from '@playwright/test';
const execute = promisify(execFile);

test('contextual RoomOS speech acceptance with real providers', async ({ baseURL }, info) => {
  test.skip(process.env.PRESENT_LIVE_ROOMOS !== '1', 'Explicit opt-in: two synthetic voice sessions and real model work.');
  test.setTimeout(330000);
  const { stdout } = await execute(process.execPath, ['tests/live/contextual-acceptance.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PRESENT_E2E_URL: baseURL, PRESENT_LIVE_ROOMOS: '1' }, timeout: 320000,
  });
  await info.attach('contextual acceptance output', { body: stdout, contentType: 'text/plain' });
});

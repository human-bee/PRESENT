import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { makeObject } from '../shared/room';
import { backupData, createBackupKey, restoreData } from '../server/operations/data-backup';

test('actual signed server refuses a second writer and restores native corrections, asset bytes and revoked grants', { timeout: 60000, skip: process.env.PRESENT_BACKUP_BROWSER !== '1' }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-backup-browser-'))); chmodSync(root, 0o700);
  const data = join(root, 'original'), restored = join(root, 'restored'), key = join(root, 'operator.key'), archive = join(root, 'backup.present');
  const origin = 'http://127.0.0.1:4459', secret = randomBytes(32).toString('hex');
  const env = (directory: string) => ({ ...process.env, NODE_ENV: 'production', PRESENT_PORT: '4459', PRESENT_HOST: '127.0.0.1', PRESENT_DATA_DIRECTORY: directory, PRESENT_ACCESS_DIRECTORY: join(directory, 'access'), PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: origin, PRESENT_ACCESS_SECRET: secret, PRESENT_ENV_FILE: join(root, 'absent.env'), CODEX_HOME: join(root, 'absent-auth'), CODEX_CLI_PATH: join(root, 'absent-codex'), OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPESAFE_AI_API_KEY: '', LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' });
  let child: ChildProcess | undefined, browser: Browser | undefined, output = '';
  const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; } child = undefined; };
  const start = async (directory: string) => {
    let started = '';
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: env(directory), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', bytes => { started += String(bytes); output += String(bytes); }); child.stderr!.on('data', bytes => { started += String(bytes); output += String(bytes); });
    for (let attempt = 0; !started.includes(`PRESENT is ready at ${origin}`); attempt++) { if (attempt > 240 || child.exitCode !== null) throw new Error(started.slice(-1500)); await pause(25); }
  };
  type Actor = { userId: string; cookie: string };
  const call = (actor: Actor | undefined, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(origin + path, { method, headers: { origin, ...(actor ? { cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T,>(response: Response, status = 200): Promise<T> => { const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value as T; };
  const session = async () => { const response = await call(undefined, '/api/access/session', {}); const actor = await json<{ userId: string }>(response, 201); return { ...actor, cookie: response.headers.get('set-cookie')!.split(';')[0] }; };
  try {
    await start(data); createBackupKey(key);
    assert.throws(() => backupData(data, archive, key), /live writer/);
    const competing = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...env(data), PRESENT_PORT: '4460' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let rejected = ''; competing.stderr!.on('data', bytes => { rejected += String(bytes); }); const [exit] = await once(competing, 'exit'); assert.notEqual(exit, 0); assert.match(rejected, /live writer/);
    const owner = await session(), guest = await session();
    const { roomId } = await json<{ roomId: string }>(await call(owner, '/api/access/rooms', {}), 201);
    const invite = await json<{ token: string }>(await call(owner, `/api/access/rooms/${roomId}/invites`, { role: 'editor', ttlMs: 60000, maxUses: 1 }), 201);
    await json(await call(guest, '/api/access/join', { token: invite.token }));
    const note = { ...makeObject('note', owner.userId, { x: 0, y: 0 }, { text: 'Original correction target.' }), id: 'retained-note' };
    await json(await call(owner, `/api/room/${roomId}/operation`, { actor: owner.userId, requestId: randomUUID(), operation: { type: 'put', object: note } }));
    const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=', 'base64');
    const asset = await json<{ src: string }>(await fetch(`${origin}/api/assets/${roomId}`, { method: 'POST', headers: { origin, cookie: owner.cookie, 'content-type': 'image/png' }, body: pixels }), 201);
    browser = await chromium.launch({ headless: true }); const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    for (const [context, actor] of [[contexts[0], owner], [contexts[1], guest]] as const) await context.addCookies([{ name: 'present_session', value: actor.cookie.slice('present_session='.length), url: origin }]);
    const [a, b] = await Promise.all(contexts.map(context => context.newPage())); await Promise.all([a.goto(`${origin}/r/${roomId}`), b.goto(`${origin}/r/${roomId}`)]);
    const editable = b.locator('.tl-note__container').filter({ hasText: 'Original correction target.' }); await editable.dblclick({ position: { x: 80, y: 70 } }); await editable.locator('[contenteditable="true"]').fill('Human correction survives the stopped-service restore.'); await b.keyboard.press('Escape');
    await expect(a.getByTestId('canvas').getByText('Human correction survives the stopped-service restore.', { exact: true })).toBeVisible();
    await json(await call(owner, `/api/access/rooms/${roomId}/members/${guest.userId}`, undefined, 'DELETE'));
    await browser.close(); browser = undefined; await stop();
    const originalSnapshot = readFileSync(join(data, 'tldraw', `${roomId}.json`));
    const before = backupData(data, archive, key), after = restoreData(archive, restored, key); assert.equal(before.manifestSha256, after.manifestSha256); assert.deepEqual(readFileSync(join(restored, 'tldraw', `${roomId}.json`)), originalSnapshot);
    await start(restored); assert.equal((await call(guest, `/api/room/${roomId}`)).status, 403); assert.equal((await call(undefined, `/api/room/${roomId}`)).status, 401);
    const retrieved = await call(owner, asset.src); assert.equal(retrieved.status, 200); assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()), pixels); assert.equal((await call(guest, asset.src)).status, 403);
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext(); await context.addCookies([{ name: 'present_session', value: owner.cookie.slice('present_session='.length), url: origin }]); const page = await context.newPage(); let paidRequests = 0; page.on('request', request => { if (/\/api\/(agents\/generate|work\/start|voice\/)/.test(new URL(request.url()).pathname)) paidRequests++; });
    await page.goto(`${origin}/r/${roomId}`); await expect(page.getByTestId('canvas').getByText('Human correction survives the stopped-service restore.', { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByTestId('canvas').getByText('Human correction survives the stopped-service restore.', { exact: true })).toBeVisible(); assert.equal(paidRequests, 0);
    const evidence = process.env.PRESENT_BACKUP_EVIDENCE_DIRECTORY;
    if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'restored-room.png') }); writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({ runtime: process.version, browser: browser.version(), actualServer: true, secondWriterRejected: true, liveBackupRejected: true, nativePeerCorrection: true, revokedGrantStillDenied: true, assetBytesExact: true, roomSnapshotExact: true, reloadPassed: true, paidRequests, backup: before, restore: after }, null, 2)); }
  } finally { await browser?.close(); await stop(); if (process.env.PRESENT_BACKUP_EVIDENCE_DIRECTORY) writeFileSync(join(process.env.PRESENT_BACKUP_EVIDENCE_DIRECTORY, 'server.log'), output); rmSync(root, { recursive: true, force: true }); }
});

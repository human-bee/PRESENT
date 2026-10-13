import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium, expect, type Browser } from '@playwright/test';
import { makeObject, type RoomObject } from '../shared/room';
import type { ContinuityPreview } from '../shared/room-continuity';

test('real signed two-room continuity previews, discards, corrects and persists selected text while rejecting stale and revoked authority', { timeout: 65000, skip: process.env.PRESENT_CONTINUITY_BROWSER !== '1' }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-continuity-'))), origin = 'http://127.0.0.1:4457';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, NODE_ENV: 'production', PRESENT_HOST: '127.0.0.1', PRESENT_PORT: '4457', PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: origin, PRESENT_ACCESS_SECRET: randomBytes(32).toString('hex'), PRESENT_ACCESS_DIRECTORY: join(root, 'access'), PRESENT_DATA_DIRECTORY: root, PRESENT_ENV_FILE: join(root, 'absent.env'), CODEX_HOME: join(root, 'absent-codex-home'), CODEX_CLI_PATH: join(root, 'absent-codex'), PRESENT_MODEL_TRANSPORT: 'codex', OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPESAFE_AI_API: '', LIVEKIT_URL: '', NEXT_PUBLIC_LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', LINEAR_API_KEY: '', YOUTUBE_API_KEY: '',
  } });
  let output = '', browser: Browser | undefined;
  child.stdout.on('data', bytes => { output += String(bytes); }); child.stderr.on('data', bytes => { output += String(bytes); });
  type Actor = { cookie: string; userId: string };
  const call = async (actor: Actor | undefined, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(`${origin}${path}`, { method, headers: { origin, ...(actor ? { cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T,>(response: Response, status = 200): Promise<T> => { const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value as T; };
  const actor = async () => { const response = await call(undefined, '/api/access/session', {}); const identity = await json<{ userId: string }>(response, 201); return { ...identity, cookie: response.headers.get('set-cookie')!.split(';')[0] }; };
  const room = async (who: Actor) => (await json<{ roomId: string }>(await call(who, '/api/access/rooms', {}), 201)).roomId;
  const joinRoom = async (owner: Actor, guest: Actor, roomId: string) => { const invite = await json<{ token: string }>(await call(owner, `/api/access/rooms/${roomId}/invites`, { role: 'editor', ttlMs: 60000, maxUses: 1 }), 201); await json(await call(guest, '/api/access/join', { token: invite.token })); };
  const put = async (who: Actor, roomId: string, object: RoomObject) => json(await call(who, `/api/room/${roomId}/operation`, { actor: who.userId, requestId: randomUUID(), operation: { type: 'put', object } }));
  const preview = async (who: Actor, roomId: string) => json<ContinuityPreview>(await call(who, '/api/templates/continuity/preview', { sourceRoomId: roomId }));
  const read = async (who: Actor, roomId: string) => (await json<{ room: { objects: RoomObject[] } }>(await call(who, `/api/room/${roomId}`))).room.objects;
  try {
    for (let attempt = 0; !output.includes(`PRESENT is ready at ${origin}`); attempt++) { if (attempt > 200 || child.exitCode !== null) throw new Error(output.slice(-2000)); await pause(25); }
    const owner = await actor(), destinationOwner = await actor(), guest = await actor();
    const source = await room(owner), target = await room(destinationOwner);
    const decision = { ...makeObject('note', 'PRIVATE_PERSON', { x: 0, y: 0 }, { text: 'Keep the decision', transcript: 'PRIVATE_TRANSCRIPT', permissions: 'PRIVATE_PERMISSIONS' }), id: 'decision' };
    const unrelated = { ...makeObject('note', 'PRIVATE_PERSON', { x: 400, y: 0 }, { text: 'Unrelated excluded' }), id: 'unrelated' };
    const artifact = { ...makeObject('widget', 'PRIVATE_PERSON', { x: 800, y: 0 }, { capability: 'artifact', format: 'markdown', state: { markdown: '# Verified source excerpt' }, jobId: 'PRIVATE_JOB', executionState: { threadId: 'PRIVATE_THREAD' } }), id: 'source' };
    const html = { ...makeObject('widget', 'PRIVATE_PERSON', { x: 1200, y: 0 }, { capability: 'artifact', format: 'html', state: { html: 'PRIVATE_HTML' } }), id: 'html' };
    const work = { ...makeObject('widget', 'PRIVATE_PERSON', { x: 1600, y: 0 }, { capability: 'work', work: { status: 'running', jobId: 'PRIVATE_JOB' } }), id: 'work' };
    for (const object of [decision, unrelated, artifact, html, work]) await put(owner, source, object);
    assert.equal((await call(undefined, '/api/templates/continuity/preview', { sourceRoomId: source })).status, 401);
    assert.equal((await call(guest, '/api/templates/continuity/preview', { sourceRoomId: source })).status, 403);
    const initial = await preview(owner, source), selected = initial.items.filter(item => item.sourceObjectId !== 'shape:unrelated').map(({ sourceObjectId, digest, text }) => ({ sourceObjectId, digest, text }));
    assert.equal(initial.items.length, 3); assert.equal(initial.omitted, 2); assert.equal(JSON.stringify(initial).includes('PRIVATE_'), false);
    const payload = { sourceRoomId: source, destinationRoomId: target, selection: selected };
    assert.equal((await call(owner, '/api/templates/continuity/apply', payload)).status, 403, 'destination requires current membership');
    await joinRoom(owner, guest, source); const guestPreview = await preview(guest, source);
    await json(await call(owner, `/api/access/rooms/${source}/members/${guest.userId}`, undefined, 'DELETE'));
    assert.equal((await call(guest, '/api/templates/continuity/apply', { sourceRoomId: source, selection: [{ sourceObjectId: guestPreview.items[0].sourceObjectId, digest: guestPreview.items[0].digest, text: guestPreview.items[0].text }] })).status, 403, 'source revocation invalidates the preview');
    await joinRoom(destinationOwner, owner, target);
    const stale = initial.items.find(item => item.sourceObjectId === 'shape:decision')!;
    await json(await call(owner, `/api/room/${source}/operation`, { actor: owner.userId, requestId: randomUUID(), operation: { type: 'patch', id: decision.id, patch: { data: { ...decision.data, text: 'Updated decision' } } } }));
    assert.equal((await call(owner, '/api/templates/continuity/apply', { ...payload, selection: [{ sourceObjectId: stale.sourceObjectId, digest: stale.digest, text: stale.text }] })).status, 409, 'changed source requires refreshing explicit preview');
    assert.deepEqual(await read(destinationOwner, target), []);
    browser = await chromium.launch({ headless: true, channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || undefined });
    const first = await browser.newContext(), second = await browser.newContext();
    for (const [context, who] of [[first, owner], [second, destinationOwner]] as const) await context.addCookies([{ name: 'present_session', value: who.cookie.slice('present_session='.length), url: origin }]);
    const sourcePage = await first.newPage(), targetPage = await second.newPage(); await sourcePage.goto(`${origin}/r/${source}`); await targetPage.goto(`${origin}/r/${target}`);
    await sourcePage.getByRole('button', { name: 'Invite', exact: true }).click();
    const panel = sourcePage.getByRole('region', { name: 'Selected continuity' });
    await panel.getByRole('button', { name: 'Preview selected continuity', exact: true }).click();
    await expect(panel.getByRole('checkbox')).toHaveCount(3); assert.equal(await panel.getByRole('checkbox').first().isChecked(), false);
    await panel.getByRole('checkbox').first().check(); await panel.getByLabel('Carry-forward text 1').fill('Discarded correction');
    await panel.getByRole('button', { name: 'Discard carry-forward preview', exact: true }).click(); await expect(panel.getByRole('checkbox')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Preview selected continuity', exact: true }).click();
    const decisionRow = panel.locator('.continuity-item').filter({ hasText: 'shape:decision' }), sourceRow = panel.locator('.continuity-item').filter({ hasText: 'shape:source' });
    await decisionRow.getByRole('checkbox').check(); await decisionRow.getByRole('textbox').fill('Corrected decision carried explicitly'); await sourceRow.getByRole('checkbox').check();
    await panel.getByLabel('Destination room ID or link').fill(`${origin}/r/${target}`);
    const evidence = process.env.PRESENT_CONTINUITY_EVIDENCE_DIRECTORY;
    if (evidence) { mkdirSync(evidence, { recursive: true }); await sourcePage.screenshot({ path: join(evidence, 'selected-preview.png'), fullPage: true }); }
    await panel.getByRole('button', { name: 'Carry 2 selected items', exact: true }).click(); await expect(sourcePage).toHaveURL(`${origin}/r/${target}`);
    await expect(targetPage.getByTestId('canvas').getByText('Corrected decision carried explicitly', { exact: true })).toBeVisible();
    await expect(targetPage.getByTestId('canvas').getByText('# Verified source excerpt', { exact: true })).toBeVisible();
    const copied = await read(destinationOwner, target); assert.equal(copied.length, 2);
    const horizontal = [...copied].sort((a, b) => a.x - b.x); assert.ok(horizontal[0].x + horizontal[0].w < horizontal[1].x, 'real copied native notes do not overlap'); assert.ok(copied.every(object => object.kind === 'note' && !['decision', 'unrelated', 'source', 'html', 'work'].includes(object.id) && object.createdBy === '' && !object.data.work && !object.data.executionState));
    assert.deepEqual(copied.map(object => object.data.text).sort(), ['# Verified source excerpt', 'Corrected decision carried explicitly'].sort());
    assert.equal(JSON.stringify(copied).includes('PRIVATE_'), false); assert.equal(JSON.stringify(copied).includes('Unrelated excluded'), false);
    const corrected = copied.find(object => object.data.text === 'Corrected decision carried explicitly')!; assert.equal((corrected.data.continuity as { corrected: boolean }).corrected, true); assert.equal((corrected.data.continuity as { sourceRoomId: string }).sourceRoomId, source);
    assert.equal((await read(owner, source)).find(object => object.id === 'decision')?.data.text, 'Updated decision');
    assert.equal((await call(owner, '/api/templates/continuity/apply', { sourceRoomId: source, destinationRoomId: target, selection: (await preview(owner, source)).items.slice(0, 1).map(({ sourceObjectId, digest, text }) => ({ sourceObjectId, digest, text })) })).status, 409, 'existing destination content is preserved');
    assert.equal((await read(destinationOwner, target)).length, 2);
    const durable = readFileSync(join(root, 'tldraw', `${target}.json`), 'utf8');
    assert.ok(durable.includes('Corrected decision carried explicitly')); assert.equal(durable.includes('PRIVATE_'), false); assert.equal(durable.includes('Unrelated excluded'), false);
    assert.deepEqual(existsSync(join(root, 'work-jobs')) ? readdirSync(join(root, 'work-jobs')).filter(name => name.endsWith('.json')) : [], [], 'continuity never creates a private work job');
    await targetPage.reload(); await expect(targetPage.getByTestId('canvas').getByText('Corrected decision carried explicitly', { exact: true })).toBeVisible();
    const nativeNote = targetPage.locator('.tl-note__container').filter({ hasText: 'Corrected decision carried explicitly' });
    await nativeNote.dblclick({ position: { x: 90, y: 80 } }); await nativeNote.locator('[contenteditable="true"]').fill('A later native correction'); await targetPage.keyboard.press('Escape');
    await expect(sourcePage.getByTestId('canvas').getByText('A later native correction', { exact: true })).toBeVisible();
    await targetPage.getByRole('button', { name: 'Room settings', exact: true }).click();
    const download = targetPage.waitForEvent('download'); await targetPage.getByRole('button', { name: 'Save this room', exact: true }).click(); const exported = await download, exportPath = await exported.path(); assert.ok(exportPath);
    const exportText = readFileSync(exportPath, 'utf8'); assert.ok(exportText.includes('A later native correction')); assert.ok(exportText.includes('sourceDigest')); assert.equal(exportText.includes('PRIVATE_'), false); assert.equal(exportText.includes('Unrelated excluded'), false);
    await targetPage.getByRole('button', { name: 'Close settings', exact: true }).click();
    const fresh = await preview(owner, source);
    const installed = await json<{ roomId: string; count: number }>(await call(owner, '/api/templates/continuity/apply', { sourceRoomId: source, selection: fresh.items.filter(item => item.sourceObjectId === 'shape:source').map(({ sourceObjectId, digest, text }) => ({ sourceObjectId, digest, text })) }), 201);
    assert.notEqual(installed.roomId, source); assert.notEqual(installed.roomId, target); assert.equal(installed.count, 1); assert.equal((await read(owner, installed.roomId))[0].data.text, '# Verified source excerpt');
    if (evidence) { await targetPage.screenshot({ path: join(evidence, 'destination-native-notes.png') }); writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({ runtime: process.version, sourceRoomId: source, destinationRoomId: target, copied }, null, 2)); }
    await json(await call(destinationOwner, `/api/access/rooms/${target}/members/${owner.userId}`, undefined, 'DELETE'));
    assert.equal((await call(owner, '/api/templates/continuity/apply', payload)).status, 409, 'old source digest is rejected before destination checks');
    const current = await preview(owner, source);
    assert.equal((await call(owner, '/api/templates/continuity/apply', { ...payload, selection: current.items.slice(0, 1).map(({ sourceObjectId, digest, text }) => ({ sourceObjectId, digest, text })) })).status, 403, 'target membership revocation prevents another carry');
    assert.equal((await read(destinationOwner, target)).length, 2);
  } finally {
    await browser?.close();
    if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
    if (process.env.PRESENT_CONTINUITY_EVIDENCE_DIRECTORY) writeFileSync(join(process.env.PRESENT_CONTINUITY_EVIDENCE_DIRECTORY, 'server.log'), output);
    rmSync(root, { recursive: true, force: true });
  }
});

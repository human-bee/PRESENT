import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { makeObject } from '../shared/room';

test('signed room, membership and uploaded asset survive SIGKILL and graceful restart of the real server', { timeout: 45000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'present-server-restart-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; probe.close(); await once(probe, 'close');
  const origin = `http://127.0.0.1:${port}`, secret = randomBytes(32).toString('hex');
  let process: ChildProcess | undefined, cookie = '';
  const start = async () => {
    process = spawn(globalThis.process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...globalThis.process.env, NODE_ENV: 'production', PRESENT_HOST: '127.0.0.1', PRESENT_PORT: String(port), PRESENT_ACCESS_MODE: 'invite',
      PRESENT_ACCESS_ORIGIN: origin, PRESENT_ACCESS_SECRET: secret, PRESENT_ACCESS_DIRECTORY: join(root, 'access'), PRESENT_DATA_DIRECTORY: root,
      PRESENT_ENV_FILE: join(root, 'absent.env'), OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '',
    } });
    let output = '';
    process.stdout?.on('data', data => { output = (output + String(data)).slice(-4000); });
    process.stderr?.on('data', data => { output = (output + String(data)).slice(-4000); });
    for (let i = 0; i < 160; i++) {
      if (process.exitCode !== null) throw new Error(`Server exited during startup: ${output}`);
      try { if ((await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Waiting for listen. */ }
      await pause(50);
    }
    throw new Error(`Server did not become ready: ${output}`);
  };
  const stop = async (signal: NodeJS.Signals) => {
    if (!process || process.exitCode !== null || process.signalCode !== null) return;
    const exited = once(process, 'exit'); process.kill(signal); await exited;
  };
  const call = (path: string, method = 'GET', body?: unknown) => fetch(`${origin}${path}`, {
    method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const foreign = (path: string) => new Promise<number>((resolve, reject) => {
    const req = request(`${origin}${path}`, { headers: { host: 'healthcheck.railway.app' } }, response => { response.resume(); resolve(response.statusCode!); });
    req.on('error', reject); req.end();
  });
  try {
    await start();
    assert.equal(await foreign('/healthz'), 200);
    assert.equal(await foreign('/api/health'), 403);
    const session = await call('/api/access/session', 'POST'); assert.equal(session.status, 201);
    cookie = session.headers.get('set-cookie')!.split(';')[0]; const { userId } = await session.json();
    const grant = await (await call('/api/access/rooms', 'POST')).json(); const roomId = grant.roomId;
    const note = makeObject('note', userId, { x: 100, y: 100 }, { text: 'Persisted crash test' });
    assert.equal((await call(`/api/room/${roomId}/operation`, 'POST', { actor: userId, requestId: 'restart-note', operation: { type: 'put', object: note } })).status, 200);
    // This explicitly waits for the ordinary debounce checkpoint, not a zero-loss claim.
    let persisted = false;
    for (let i = 0; i < 100; i++) {
      try { persisted = readFileSync(join(root, 'tldraw', `${roomId}.json`), 'utf8').includes('Persisted crash test'); } catch { /* Not flushed yet. */ }
      if (persisted) break; await pause(20);
    }
    assert.equal(persisted, true);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6s1sAAAAASUVORK5CYII=', 'base64');
    const upload = await fetch(`${origin}/api/assets/${roomId}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'image/png' }, body: png });
    assert.equal(upload.status, 201); const { src } = await upload.json();
    for (const signal of ['SIGKILL', 'SIGTERM'] as const) {
      await stop(signal); await start();
      assert.equal((await call(`/api/access/rooms/${roomId}`)).status, 200, 'signed session survives restart');
      const room = await (await call(`/api/room/${roomId}`)).json();
      assert.equal(room.room.objects[0].data.text, 'Persisted crash test');
      assert.deepEqual(Buffer.from(await (await call(src)).arrayBuffer()), png);
      assert.equal((await fetch(`${origin}/api/room/${roomId}`)).status, 401, 'restart never opens anonymous room reads');
    }
  } finally { await stop('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
});

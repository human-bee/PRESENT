/** Local CPU/disk only: node --import tsx server/access/benchmark.ts [iterations] */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { RoomAccess, authorizationPath } from './index';
const directory = mkdtempSync(join(tmpdir(), 'present-access-bench-'));
const count = Number(process.argv[2] ?? 100_000);
if (!Number.isInteger(count) || count < 1 || count > 10_000_000) throw new Error('Iterations must be 1..10000000.');
const access = new RoomAccess({ directory, secret: randomBytes(32).toString('hex') });
try {
  const session = access.createSession(), room = access.createRoom(session.token);
  const check = authorizationPath(access, session.token, room.roomId, 'write');
  for (let i = 0; i < 1000; i++) check();
  const start = performance.now();
  for (let i = 0; i < count; i++) check();
  const elapsedMs = performance.now() - start;
  console.log(JSON.stringify({ iterations: count, elapsedMs, microsecondsPerCheck: elapsedMs * 1000 / count, checksPerSecond: count * 1000 / elapsedMs, scope: 'HMAC + session expiry/revocation + room membership + permission; single process, warm memory' }, null, 2));
} finally { access.close(); rmSync(directory, { recursive: true, force: true }); }

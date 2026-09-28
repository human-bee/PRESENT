/** node --import tsx server/access/integration-benchmark.ts [iterations] */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { RoomAccess } from './store';
import { installNativeAccessGuard } from './native-guard';
import { createRoomAuthorization, withRoomAuthorization } from './context';
import { RoomStore } from '../room-store';
const count = Number(process.argv[2] ?? 20000);
if (!Number.isInteger(count) || count < 1 || count > 1000000) throw new Error('Use 1..1000000 iterations.');
const directory = mkdtempSync(join(tmpdir(), 'present-auth-overhead-'));
const native = new RoomStore({ directory: join(directory, 'rooms'), debounceMs: 1000000 });
const access = new RoomAccess({ directory: join(directory, 'access'), secret: randomBytes(32).toString('hex') });
let restore = () => {};
try {
  const session = access.createSession(), room = access.createRoom(session.token);
  const scope = createRoomAuthorization(access, session.token, room.roomId);
  const measure = (read: () => unknown) => { for (let i = 0; i < 1000; i++) read(); const start = performance.now(); for (let i = 0; i < count; i++) read(); return (performance.now() - start) * 1000 / count; };
  const baselineUs = measure(() => native.getRoom(room.roomId));
  restore = installNativeAccessGuard();
  const authorizedUs = withRoomAuthorization(scope, () => measure(() => native.getRoom(room.roomId)));
  console.log(JSON.stringify({ iterations: count, baselineUs, authorizedUs, addedUs: authorizedUs - baselineUs, scope: 'Warm native room projection reads, including all nested live membership checks; no network or providers' }, null, 2));
} finally { restore(); native.close(); access.close(); rmSync(directory, { recursive: true, force: true }); }

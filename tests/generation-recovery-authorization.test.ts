import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RoomAccess, AccessError } from '../server/access/store';
import { enforceRoomAuthorization, createRoomAuthorization, withRoomAuthorization } from '../server/access/context';
import { prepareAccessDispatch, dispatchAuthorized } from '../server/access/dispatch';
import { handleAgentRequest } from '../server/agent-routes';
import { requestJournal } from '../server/agents/request-journal';
import { generationRequestSchema } from '../server/agents/contract';
import { fulfillRoomRequest } from '../server/agents/fulfill-request';
class ControlledResponse extends EventEmitter {
  destroyed = false; writableEnded = false; status = 0; body: Record<string, unknown> = {};
  writeHead(status: number) { this.status = status; return this; }
  end(text: string) { this.body = JSON.parse(text); this.writableEnded = true; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
}
async function fixture(run: (f: { access: RoomAccess; input: Record<string, unknown>; owner: ReturnType<RoomAccess['createSession']>; expire: () => void }) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'present-generation-auth-')), previous = process.env.PRESENT_DATA_DIRECTORY;
  process.env.PRESENT_DATA_DIRECTORY = directory; enforceRoomAuthorization(true);
  let now = Date.now(); const access = new RoomAccess({ directory: join(directory, 'access'), secret: randomBytes(32).toString('hex'), now: () => now });
  const owner = access.createSession(), { roomId } = access.createRoom(owner.token);
  const input = { roomId, actor: owner.userId, requestId: 'recover-expiry', prompt: 'Synthetic public input', provider: 'sol', position: { x: 0, y: 0 } };
  try { await run({ access, input, owner, expire: () => { now = owner.expiresAt + 1; } }); }
  finally { access.close(); enforceRoomAuthorization(false); if (previous === undefined) delete process.env.PRESENT_DATA_DIRECTORY; else process.env.PRESENT_DATA_DIRECTORY = previous; rmSync(directory, { recursive: true, force: true }); }
}
const seed = async (input: Record<string, unknown>) => {
  const normalized = { ...input, ...generationRequestSchema.parse(input) };
  await requestJournal.run(normalized as never, normalized, async () => ({ kind: 'canvas', provider: 'sol', objectIds: ['synthetic-result'], elapsedMs: 1 }));
};
const request = (input: Record<string, unknown>, token: string) => {
  const stream = Readable.from([Buffer.from(JSON.stringify({ ...input, recoverOnly: true }))]);
  Object.assign(stream, { method: 'POST', url: '/api/agents/generate', headers: { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'content-type': 'application/json', cookie: 'present_session=' + token }, socket: {} });
  return stream as unknown as IncomingMessage;
};
test('signed recovery requires current tools authority and initiating actor before private result reads', async () => fixture(async f => {
  await assert.rejects(fulfillRoomRequest({ ...f.input, recoverOnly: true }), AccessError);
  const scope = createRoomAuthorization(f.access, f.owner.token, String(f.input.roomId));
  await assert.rejects(withRoomAuthorization(scope, () => fulfillRoomRequest({ ...f.input, actor: 'someone-else', recoverOnly: true })), /another participant/);
  assert.equal(readdirSync(process.env.PRESENT_DATA_DIRECTORY!).includes('agent-requests'), false);
  await seed(f.input);
  const recovered = await withRoomAuthorization(scope, () => fulfillRoomRequest({ ...f.input, recoverOnly: true }));
  assert.equal(recovered.replayed, true);
}));
test('session expiry after completed receipt read is denied before returning its result', async () => fixture(async f => {
  await seed(f.input); const original = requestJournal.recover;
  requestJournal.recover = function (this: typeof requestJournal, ...args: Parameters<typeof original>) { const result = original.apply(this, args); f.expire(); return result; } as typeof original;
  try {
    const prepared = await prepareAccessDispatch(f.access, request(f.input, f.owner.token)), response = new ControlledResponse();
    await dispatchAuthorized(prepared, response as unknown as ServerResponse, req => handleAgentRequest(req, response as unknown as ServerResponse));
    assert.equal(response.status, 401); assert.equal(response.body.objectIds, undefined); assert.equal(response.body.replayed, undefined);
  } finally { requestJournal.recover = original; }
}));
test('final generate HTTP reply rechecks expiry after fulfill result authorization', async () => fixture(async f => {
  await seed(f.input);
  const prepared = await prepareAccessDispatch(f.access, request(f.input, f.owner.token)), response = new ControlledResponse();
  const check = prepared.scope.check; let toolsChecks = 0;
  prepared.scope.check = permission => {
    const grant = check(permission);
    if (permission === 'tools' && ++toolsChecks === 2) f.expire();
    return grant;
  };
  await dispatchAuthorized(prepared, response as unknown as ServerResponse, req => handleAgentRequest(req, response as unknown as ServerResponse));
  assert.ok(toolsChecks >= 2); assert.equal(response.status, 401); assert.equal(response.body.objectIds, undefined);
}));

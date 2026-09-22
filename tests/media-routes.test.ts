import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { TokenVerifier } from 'livekit-server-sdk';
import { handleMediaRequest } from '../server/media-routes';

const configuration = ['LIVEKIT_URL', 'NEXT_PUBLIC_LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
const original = Object.fromEntries(configuration.map((key) => [key, process.env[key]]));
const server = createServer(async (req, res) => {
  if (!await handleMediaRequest(req, res)) { res.writeHead(404); res.end(); }
});
let base = '';
const valid = { roomId: 'b'.repeat(32), identity: 'person-123', name: 'Human' };
function request(body: unknown = valid) {
  return fetch(`${base}/api/media/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  for (const key of configuration) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('unconfigured calls report 503 and never pretend to issue a token', async () => {
  for (const key of configuration) delete process.env[key];
  const response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Calls are not configured on this server yet.' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('tokens grant only the requested room and expire within fifteen minutes', async () => {
  process.env.LIVEKIT_URL = 'wss://media.example.test';
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'unit-test-secret-at-least-32-characters';
  const response = await request();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'wss://media.example.test/');
  const claims = await new TokenVerifier(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET).verify(payload.token);
  assert.equal(claims.sub, valid.identity);
  assert.equal(claims.name, valid.name);
  assert.equal(claims.video?.room, valid.roomId);
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.canPublishData, false);
  assert.equal(claims.video?.roomAdmin, undefined);
  assert(Number(claims.exp) <= Math.floor(Date.now() / 1000) + 900);
});
test('rejects invalid capabilities, identities, names, malformed and oversized JSON', async () => {
  for (const body of [null, {}, { ...valid, roomId: 'general' }, { ...valid, identity: '../person' },
    { ...valid, name: '\nHuman' }, { ...valid, name: 'x'.repeat(61) }, { ...valid, name: ' ' }]) {
    assert.equal((await request(body)).status, 400);
  }
  const malformed = await fetch(`${base}/api/media/token`, { method: 'POST', body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await request({ ...valid, extra: 'x'.repeat(5000) })).status, 400);
});
test('the token endpoint rejects GET and does not swallow unrelated routes', async () => {
  assert.equal((await fetch(`${base}/api/media/token`)).status, 405);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
});

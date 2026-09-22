import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { mcpAppSchema } from '../shared/mcp-app';
import { RoomStore } from '../server/room-store';
import { McpApps } from '../server/mcp/apps';
import { mcpProfileSchema, readMcpProfiles } from '../server/mcp/profiles';
import { createSandboxGrant, mcpSandboxPolicy, restrictMcpCsp, sandboxDocument } from '../server/mcp/sandbox';
import { fixtureResourceUri, startMcpFixture } from '../server/mcp/fixture';

const directory = mkdtempSync(join(tmpdir(), 'present-mcp-test-')), roomId = 'b'.repeat(32), actor = 'mcp-fixture-human';
const store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') }), audits: Record<string, unknown>[] = [];
let fixture: Awaited<ReturnType<typeof startMcpFixture>>, apps: McpApps, objectId: string, appSession: string;
before(async () => {
  fixture = await startMcpFixture();
  const profile = mcpProfileSchema.parse({ id: 'local-fixture', title: 'Local fixture', url: fixture.url, headers: { 'X-Fixture-Secret': 'local-fixture-secret' }, tools: ['fixture_counter', 'fixture_increment', 'fixture_model_only'] });
  apps = new McpApps({ profiles: () => [profile], getRoom: store.getRoom.bind(store), applyOperation: store.applyOperation.bind(store), audit: event => audits.push(event) });
});
after(async () => { await fixture?.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });

test('MCP server profiles are absolute, validated, and expose no connection credentials', () => {
  const path = join(directory, 'profiles.json');
  writeFileSync(path, JSON.stringify({ profiles: [{ id: 'fixture', title: 'Fixture', url: fixture.url, tools: ['fixture_counter'], headers: { Authorization: 'private-fixture-value' } }] }));
  assert.equal(readMcpProfiles(path)[0].headers.Authorization, 'private-fixture-value');
  assert.throws(() => readMcpProfiles('relative.json'), /server-owned/);
  assert.throws(() => mcpProfileSchema.parse({ id: 'bad', title: 'Bad', url: 'http://external.example/mcp', tools: ['counter'] }));
  assert.deepEqual(apps.profiles(), [{ id: 'local-fixture', title: 'Local fixture', tools: ['fixture_counter', 'fixture_increment', 'fixture_model_only'] }]);
  assert.equal(JSON.stringify(apps.profiles()).includes('secret'), false);
});

test('real SDK transport creates only an opaque linked reference and opening does not execute tools', async () => {
  ({ objectId } = await apps.create({ roomId, actor, serverProfile: 'local-fixture', toolName: 'fixture_counter', toolInput: { label: 'Shared local fixture' } }));
  const object = store.getRoom(roomId).objects.find(item => item.id === objectId); assert.ok(object);
  assert.deepEqual(mcpAppSchema.parse(object.data), { capability: 'mcp-app', version: 1, serverProfile: 'local-fixture', toolName: 'fixture_counter', resourceUri: fixtureResourceUri, toolInput: { label: 'Shared local fixture' } });
  assert.equal(JSON.stringify(object).includes('local-fixture-secret'), false); assert.equal(JSON.stringify(object).includes(fixture.url), false);
  const open = await apps.open({ roomId, actor, objectId }, 'http://127.0.0.1:4329');
  appSession = open.appSession;
  assert.match(open.html, /Local MCP fixture/); assert.match(open.sandboxUrl, /^http:\/\/localhost:4329\/mcp\/sandbox\/[a-f0-9]{48}$/); assert.equal(open.result, null); assert.deepEqual(fixture.calls, []);
  assert.deepEqual(open.permissions, {}); assert.deepEqual(fixture.capabilities(), { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
});

test('SDK tool calls preserve request replay, app visibility, the profile allowlist, and canonical linkage', async () => {
  const identity = { roomId, actor, objectId, appSession }, run = { ...identity, requestId: 'fixture-run' };
  const [one, two] = await Promise.all([apps.call(run, false), apps.call(run, false)]);
  assert.deepEqual(one, two); assert.deepEqual(fixture.calls, ['fixture_counter']);
  const increment = await apps.call({ ...identity, requestId: 'fixture-increment', name: 'fixture_increment', arguments: { amount: 2 } }, true);
  assert.equal(increment.structuredContent?.count, 2); assert.equal(fixture.count(), 2);
  await assert.rejects(apps.call({ ...identity, requestId: 'fixture-increment', name: 'fixture_increment', arguments: { amount: 3 } }, true), /another call/);
  await assert.rejects(apps.call({ ...identity, requestId: 'model-only', name: 'fixture_model_only' }, true), /not visible/);
  await assert.rejects(apps.call({ ...identity, requestId: 'not-configured', name: 'unknown_tool' }, true), /not allowed/);
  assert.deepEqual(fixture.calls, ['fixture_counter', 'fixture_increment']);
  assert.ok(audits.some(event => event.action === 'tool-result')); assert.equal(JSON.stringify(audits).includes('local-fixture-secret'), false);
  store.applyOperation(roomId, { type: 'patch', id: objectId, patch: { data: { resourceUri: 'ui://not-the-linked-resource' } } }, actor);
  await assert.rejects(apps.open({ roomId, actor, objectId }, 'http://127.0.0.1:4329'), /does not match/);
  store.applyOperation(roomId, { type: 'patch', id: objectId, patch: { data: { resourceUri: fixtureResourceUri } } }, actor);
});

test('app context remains bounded untrusted server state and never becomes shape data', () => {
  apps.context({ roomId, actor, objectId, appSession, context: { content: [{ type: 'text', text: 'Local fixture count is 2' }] } });
  assert.equal(apps.readContexts(roomId)[0].contentTrust, 'untrusted-mcp-app');
  assert.equal(store.getRoom(roomId).objects.find(item => item.id === objectId)?.data.context, undefined);
  assert.throws(() => apps.context({ roomId, actor, objectId, appSession, context: { content: [{ type: 'text', text: 'x'.repeat(13000) }] } }), /too much data/);
});

test('an open app session cannot follow a changed reference or act as another human', async () => {
  const call = { roomId, actor, objectId, appSession, requestId: 'changed-session', name: 'fixture_increment', arguments: { amount: 1 } }, before = fixture.calls.length;
  await assert.rejects(apps.call({ ...call, actor: 'different-human' }, true), /session no longer matches/);
  store.applyOperation(roomId, { type: 'patch', id: objectId, patch: { data: { toolInput: { label: 'A different invocation' } } } }, actor);
  await assert.rejects(apps.call(call, true), /session no longer matches/);
  await assert.rejects(apps.resource({ roomId, actor, objectId, appSession }, fixtureResourceUri), /session no longer matches/);
  assert.throws(() => apps.context({ roomId, actor, objectId, appSession, context: {} }), /session no longer matches/);
  assert.equal(fixture.calls.length, before); assert.deepEqual(apps.readContexts(roomId), []);
  const reopened = await apps.open({ roomId, actor, objectId }, 'http://127.0.0.1:4329');
  assert.notEqual(reopened.appSession, appSession);
  const result = await apps.call({ ...call, appSession: reopened.appSession }, true); assert.equal(result.structuredContent?.count, 3);
});

test('sandbox CSP intersects declared domains with host approval and keeps the view opaque', () => {
  const csp = restrictMcpCsp({ connectDomains: ['https://allowed.example', 'https://blocked.example'], resourceDomains: ['https://allowed.example'], frameDomains: ['https://blocked.example'] }, ['https://allowed.example']);
  assert.deepEqual(csp.connectDomains, ['https://allowed.example']); assert.deepEqual(csp.frameDomains, []);
  const policy = mcpSandboxPolicy(csp, 'http://127.0.0.1:4329'); assert.ok(!policy.includes('blocked.example')); assert.match(policy, /form-action 'none'/);
  const empty = mcpSandboxPolicy(restrictMcpCsp(undefined, []), 'http://127.0.0.1:4329'); assert.match(empty, /connect-src 'none'/);
  assert.throws(() => createSandboxGrant('http://localhost:4329', {}), /127.0.0.1/);
  assert.match(sandboxDocument('http://127.0.0.1:4329'), /event.origin==='null'/); assert.match(sandboxDocument('http://127.0.0.1:4329'), /setAttribute\('sandbox','allow-scripts'\)/);
});

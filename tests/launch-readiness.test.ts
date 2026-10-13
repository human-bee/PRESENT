import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverLaunchCapabilities } from '../server/launch/capabilities';
import { launchReadiness } from '../server/launch/readiness';
import { agentModels } from '../shared/agent-models';

test('planning API catalog never implies an authenticated workspace executor or execution verification', async () => {
  const previous = process.env.PRESENT_MODEL_TRANSPORT; process.env.PRESENT_MODEL_TRANSPORT = 'openai';
  try {
    const capabilities = await discoverLaunchCapabilities({ workspace: async () => ({ configured: false, authenticated: false, models: [] }), planning: async () => ({ providers: [{ id: 'sol', name: 'Sol 6.1', model: agentModels.sol, configured: true, reasoning: ['high'], fast: false }] }) });
    assert.equal(capabilities.defaultProvider, 'sol'); assert.equal(capabilities.planning.transport, 'openai-responses');
    assert.equal(capabilities.planning.catalogVerified, true); assert.equal(capabilities.planning.generationVerified, false);
    assert.equal(capabilities.workspace.supported, false); assert.equal(capabilities.workspace.status, 'unavailable');
    assert.equal(capabilities.workspace.authenticated, false); assert.equal(capabilities.workspace.executionVerified, false);
  } finally { if (previous === undefined) delete process.env.PRESENT_MODEL_TRANSPORT; else process.env.PRESENT_MODEL_TRANSPORT = previous; }
});

test('preflight distinguishes exact revision, durable topology and public license presence from acceptance', () => {
  const expected = 'a'.repeat(40), secret = 'PRIVATE-SENTINEL-DO-NOT-PRINT'.repeat(2), license = 'LICENSE-SENTINEL-DO-NOT-PRINT';
  const report = launchReadiness({ env: { NODE_ENV: 'production', PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: 'https://present.example', PRESENT_ACCESS_SECRET: secret, PRESENT_DATA_DIRECTORY: '/data/native', PRESENT_ACCESS_DIRECTORY: '/data/access', VITE_TLDRAW_LICENSE_KEY: license, OPENAI_API_KEY: secret }, revision: expected, observedRevision: 'b'.repeat(40), health: 'healthy', replicas: 1, persistentRoot: '/data' });
  const text = JSON.stringify(report); assert.equal(text.includes(secret), false); assert.equal(text.includes(license), false);
  assert.equal(report.source.exactRevision, false); assert.equal(report.license.buildKeyPresent, true); assert.equal(report.license.validity, 'unverified');
  assert.ok(report.gaps.some(gap => gap.includes('exact requested revision'))); assert.ok(report.gaps.some(gap => gap.includes('active tldraw license')));
  assert.equal(report.status, 'blocked');
  const invalid = launchReadiness({ env: { PRESENT_DATA_DIRECTORY: `${process.cwd()}/public/private`, PRESENT_ACCESS_DIRECTORY: '/elsewhere/access' }, replicas: 2, persistentRoot: '/data' });
  assert.ok(invalid.gaps.some(gap => gap.includes('static public/dist'))); assert.ok(invalid.gaps.some(gap => gap.includes('exactly one'))); assert.ok(invalid.gaps.some(gap => gap.includes('covered')));
});

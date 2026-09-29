import assert from 'node:assert/strict';
import test from 'node:test';
import { missingProductionLicense } from '../src/access/license-readiness';
test('cloud production explains a missing license without changing vendor validation', () => {
  assert.equal(missingProductionLicense(true, 'example.com'), true);
  assert.equal(missingProductionLicense(true, 'example.com', '   '), true);
  assert.equal(missingProductionLicense(true, 'example.com', 'operator-provided-license'), false);
  assert.equal(missingProductionLicense(false, 'example.com'), false);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(missingProductionLicense(true, host), false);
  assert.equal(missingProductionLicense(true, 'localhost.example.com'), true);
});

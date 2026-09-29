import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAccessOrigin } from '../server/access/http';

test('managed preview permits only its exact development origin and retains request origin checks', () => {
  const previousNode = process.env.NODE_ENV, previousPreview = process.env.PRESENT_MANAGED_PREVIEW;
  const origin = 'http://terminal.local:4173';
  const request = { headers: { host: 'terminal.local:4173', origin }, method: 'POST' };
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.PRESENT_MANAGED_PREVIEW;
    assert.throws(() => assertAccessOrigin(request, origin, true));
    process.env.PRESENT_MANAGED_PREVIEW = '1';
    assert.doesNotThrow(() => assertAccessOrigin(request, origin, true));
    assert.throws(() => assertAccessOrigin({ ...request, headers: { ...request.headers, origin: 'https://evil.example' } }, origin, true));
    assert.throws(() => assertAccessOrigin({ headers: { host: 'terminal.local:4173' }, method: 'POST' }, origin, true));
    assert.throws(() => assertAccessOrigin({ ...request, headers: { ...request.headers, host: 'evil.example' } }, origin, true));
    assert.throws(() => assertAccessOrigin(request, 'http://terminal.local:4174', true));
    process.env.NODE_ENV = 'production';
    assert.throws(() => assertAccessOrigin(request, origin, true));
    assert.doesNotThrow(() => assertAccessOrigin({ headers: { host: 'present.example', origin: 'https://present.example' }, method: 'POST' }, 'https://present.example', true));
  } finally {
    if (previousNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNode;
    if (previousPreview === undefined) delete process.env.PRESENT_MANAGED_PREVIEW; else process.env.PRESENT_MANAGED_PREVIEW = previousPreview;
  }
});

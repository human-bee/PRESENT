import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { test } from 'node:test';
import { isLocalRequest } from '../server/http.js';

test('HTTP and WebSocket origin guard rejects foreign hosts and origins', () => {
  const request = (host: string, origin?: string) => ({ headers: { host, origin } }) as IncomingMessage;
  assert.equal(isLocalRequest(request('127.0.0.1:4317', 'http://127.0.0.1:4317'), 4317), true);
  assert.equal(isLocalRequest(request('localhost:4317', 'http://localhost:4317'), 4317), true);
  assert.equal(isLocalRequest(request('127.0.0.1:4317'), 4317), true);
  assert.equal(isLocalRequest(request('evil.example:4317'), 4317), false);
  assert.equal(isLocalRequest(request('127.0.0.1:4317', 'https://evil.example'), 4317), false);
  assert.equal(isLocalRequest(request('127.0.0.1:4317', 'null'), 4317), false);
  assert.equal(isLocalRequest(request('127.0.0.1:9999'), 4317), false);
});

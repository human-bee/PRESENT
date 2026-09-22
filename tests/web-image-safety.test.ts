import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicAddress, publicFetch } from '../server/agents/public-fetch';
import { voicePlacement } from '../src/voice/placement';
test('image fetch rejects private, loopback, link-local and mapped addresses', async () => {
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.2','::1','::ffff:127.0.0.1','100.64.0.1','224.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  await assert.rejects(publicFetch('http://example.com', 100));
  await assert.rejects(publicFetch('https://user:pass@example.com', 100));
});
test('placement follows selected bounds and skips an occupied rectangle', () => {
  const view = { pageId: 'page:p', capturedAt: 0, selectedIds: ['shape:a'], viewport: { x: 0, y: 0, w: 1000, h: 1000 }, shapes: [
    { id: 'shape:a', type: 'geo', x: 200, y: 300, bounds: { x: 200, y: 300, w: 600, h: 400 } },
    { id: 'shape:b', type: 'geo', x: 200, y: 732, bounds: { x: 200, y: 732, w: 600, h: 100 } },
  ] };
  assert.deepEqual(voicePlacement(view, { nearObjectId: 'a', side: 'below' }), { x: 200, y: 864 });
  assert.throws(() => voicePlacement(view, { nearObjectId: 'missing' }));
});

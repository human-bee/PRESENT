import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedImageUrl } from '../server/agents/web-images';

test('remote image imports reject private, credential, lookalike and arbitrary hosts', () => {
  for (const url of ['http://127.0.0.1/image.png', 'https://upload.wikimedia.org.evil.test/wikipedia/commons/x.png', 'https://user:pass@upload.wikimedia.org/wikipedia/commons/x.png', 'https://upload.wikimedia.org:444/wikipedia/commons/x.png', 'https://example.com/x.png']) assert.equal(allowedImageUrl(url), false);
  assert.equal(allowedImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/test.png'), true);
  assert.equal(allowedImageUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/test.png'), true);
});

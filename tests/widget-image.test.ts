import assert from 'node:assert/strict';
import test from 'node:test';
import { localImageSource } from '../src/widgets/image';

test('canvas images accept local raster assets and reject remote or escaped paths', () => {
  assert.equal(localImageSource('/media/speed-and-judgment.png'), '/media/speed-and-judgment.png');
  for (const value of ['https://example.com/track.png', '//example.com/track.png', '/media/../secret.png', '/media/%2e%2e/secret.png', '/media/image.svg', '/media/image.png?redirect=1', null]) {
    assert.equal(localImageSource(value), null);
  }
});

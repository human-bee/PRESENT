import assert from 'node:assert/strict';
import test from 'node:test';
import { makeMediaObject, readMediaReference } from '../shared/media-reference';

test('camera and screen tiles persist stable participant references with independent native object identities', () => {
  const camera = makeMediaObject('participant-123', 'Alice', 'participant', 'actor-456', { x: 10, y: 20 });
  const screen = makeMediaObject('participant-123', 'Alice', 'screen-share', 'actor-456', { x: 30, y: 40 });
  assert.equal(camera.kind, 'widget');
  assert.equal(screen.kind, 'widget');
  assert.notEqual(camera.id, screen.id);
  assert.equal(camera.createdBy, 'actor-456');
  assert.equal(camera.x, 10);
  assert.equal(screen.y, 40);
  assert.deepEqual(camera.data, { capability: 'participant', participantId: 'participant-123', name: 'Alice' });
  assert.deepEqual(screen.data, { capability: 'screen-share', participantId: 'participant-123', name: 'Alice' });
  const restored = JSON.parse(JSON.stringify(screen));
  assert.deepEqual(readMediaReference(restored.data), screen.data);
  assert.equal(restored.expiresAt, null);
});

test('media references reject malformed selectors, identities and serialized runtime or permission state', () => {
  const valid = { capability: 'participant', participantId: 'stable-person', name: 'Alice' };
  assert.deepEqual(readMediaReference(valid), valid);
  for (const value of [null, [], {}, { ...valid, capability: 'microphone' }, { ...valid, participantId: '' }, { ...valid, participantId: 'x'.repeat(101) }, { ...valid, participantId: '../someone' }, { ...valid, name: '' }, { ...valid, name: 'Alice\u0000' }, { ...valid, name: 'x'.repeat(81) }, { ...valid, stream: {} }, { ...valid, trackSid: 'ephemeral-track' }, { ...valid, cameraPermission: 'granted' }, { ...valid, html: '<script>capture()</script>' }]) {
    assert.equal(readMediaReference(value), null);
  }
});

test('tile creation validates geometry and cleans display labels without using any media devices', () => {
  const object = makeMediaObject('participant-123', '  Alice\u0000  ', 'participant', 'actor-456', { x: 0, y: 0 });
  assert.equal(object.data.name, 'Alice');
  assert.equal(makeMediaObject('participant-123', ' ', 'screen-share', 'actor-456', { x: 0, y: 0 }).data.name, 'Someone');
  assert.throws(() => makeMediaObject('', 'Alice', 'participant', 'actor', { x: 0, y: 0 }));
  assert.throws(() => makeMediaObject('participant-123', 'Alice', 'participant', 'actor', { x: Infinity, y: 0 }));
  assert.deepEqual(Object.keys(object.data).sort(), ['capability', 'name', 'participantId']);
});

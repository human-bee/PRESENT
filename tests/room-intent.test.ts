import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomIntentOutputSchema, parseRoomIntent } from '../server/agents/room-intent';

test('provider grammar uses an object envelope and nested anyOf with all object keys required', () => {
  const schema = roomIntentOutputSchema as Record<string, unknown>;
  assert.equal(schema.type, 'object'); assert.equal(schema.anyOf, undefined);
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    assert.equal(item.oneOf, undefined);
    if (item.properties) {
      assert.deepEqual(item.required, Object.keys(item.properties));
      const properties = item.properties as Record<string, { const?: unknown }>;
      const discriminator = ['kind', 'type', 'shapeType'].find(key => properties[key]?.const !== undefined);
      if (discriminator) assert.equal(Object.keys(properties)[0], discriminator);
      assert.equal(item.additionalProperties, false);
    }
    Object.values(item).forEach(visit);
  };
  visit(schema);
});

test('transport null only omits optional native arguments and preserves required widget target null', () => {
  const native = parseRoomIntent(JSON.stringify({ result: { kind: 'canvas', batch: { pageId: 'page:page', commands: [
    { type: 'create_note', x: 1, y: 2, ref: null, text: 'Hello', color: 'yellow' },
    { type: 'update_shape', id: 'shape:known', x: null, y: null, rotation: null,
      patch: { shapeType: 'geo', props: { w: null, h: null, geo: null, text: 'Human target', color: null, fill: null } } },
  ] } } }));
  assert.equal(native.kind, 'canvas');
  if (native.kind !== 'canvas') return;
  assert.equal('ref' in native.batch.commands[0], false);
  assert.deepEqual(native.batch.commands[1], { type: 'update_shape', id: 'shape:known', patch: { shapeType: 'geo', props: { text: 'Human target' } } });
  const widget = parseRoomIntent(JSON.stringify({ result: { kind: 'widget', widget: { intent: 'create', targetId: null, title: 'Count', html: '<button>Count</button>', width: 300, height: 200 } } }));
  assert.equal(widget.kind === 'widget' && widget.widget.targetId, null);
  assert.throws(() => parseRoomIntent(JSON.stringify({ result: { kind: 'note', title: 'Missing text', text: null } })));
  assert.throws(() => parseRoomIntent(JSON.stringify({ result: { kind: 'canvas', batch: { pageId: 'page:page', commands: [{ type: 'delete_shape', id: null }] } } })));
});

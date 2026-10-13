import assert from 'node:assert/strict';
import { test } from 'node:test';
import { savePendingGeneration, updatePendingGeneration, loadPendingGeneration } from '../src/requests/pending-generation';

test('the saved request retains exact pixels and discovery step across reload', () => {
  const values = new Map<string, string>();
  const old = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null } });
  try {
    const selection = ['picture'];
    const pending = savePendingGeneration({ roomId: 'a'.repeat(32), actor: 'author', prompt: 'Animate this', selection, canvasImage: 'data:image/jpeg;base64,YWJj', canvasImageCaption: 'Selected diagram' });
    selection.push('later-selection');
    const advanced = updatePendingGeneration({ ...pending, attempt: 1, payload: { ...pending.payload, nativeCatalog: { tools: ['create_geo'] } } });
    assert.deepEqual(loadPendingGeneration(pending.roomId, pending.actor), advanced);
    assert.deepEqual(advanced.payload.selection, ['picture']);
    const interrupted = updatePendingGeneration({ ...advanced, outcome: 'interrupted' });
    assert.equal(loadPendingGeneration(pending.roomId, pending.actor)?.outcome, interrupted.outcome);
    assert.equal(loadPendingGeneration(pending.roomId, 'another-author'), null);
    values.set(`present:pending-generation:${pending.roomId}:${pending.actor}`, JSON.stringify({ ...advanced, attempt: 2 }));
    assert.equal(loadPendingGeneration(pending.roomId, pending.actor), null);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { setItem: () => { throw new Error('Quota'); } } });
    assert.throws(() => savePendingGeneration({ roomId: pending.roomId, actor: pending.actor, prompt: 'Do not dispatch an unsaved request' }), /could not save/);
  } finally { if (old) Object.defineProperty(globalThis, 'sessionStorage', old); else Reflect.deleteProperty(globalThis, 'sessionStorage'); }
});

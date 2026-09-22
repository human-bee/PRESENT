import assert from 'node:assert/strict';
import test from 'node:test';
import { createWidgetStateView } from '../src/widgets/pending-widget-state';

test('delayed native receipts preserve later typed characters and independent participant keys', () => {
  const view = createWidgetStateView({ markdown: '', peer: 0 });
  view.add({ requestId: 'first', patch: { markdown: 'A' } });
  view.add({ requestId: 'second', patch: { markdown: 'AB' } });
  assert.deepEqual(view.receive({ markdown: 'A', peer: 1 }, ['first']), { markdown: 'AB', peer: 1 });
  assert.deepEqual(view.receive({ markdown: 'AB', peer: 2 }, ['first', 'second']), { markdown: 'AB', peer: 2 });
  // Once the local transaction is seen, a later participant write is authoritative.
  assert.deepEqual(view.receive({ markdown: 'Their edit', peer: 3 }, ['first', 'second']), { markdown: 'Their edit', peer: 3 });
});

test('native increment receipts retire exactly the applied local increment without doubling peer increments', () => {
  const view = createWidgetStateView({ score: 0 });
  view.add({ requestId: 'first', key: 'score', by: 1 });
  view.add({ requestId: 'second', key: 'score', by: 1 });
  assert.deepEqual(view.receive({ score: 2 }, ['first', 'peer']), { score: 3 });
  assert.deepEqual(view.receive({ score: 3 }, ['first', 'peer', 'second']), { score: 3 });
});

test('failed edits roll back against the latest native state while newer pending edits survive', () => {
  const view = createWidgetStateView({ markdown: '', score: 0 });
  view.add({ requestId: 'failed', patch: { markdown: 'A' } });
  view.add({ requestId: 'newer', patch: { markdown: 'AB' } });
  view.receive({ markdown: 'Peer', score: 4 }, []);
  assert.deepEqual(view.reject('failed'), { markdown: 'AB', score: 4 });
  assert.deepEqual(view.reject('newer'), { markdown: 'Peer', score: 4 });
});

test('an edit made while a native message is in transit remains visible until its own receipt', () => {
  const view = createWidgetStateView({ markdown: '' });
  view.add({ requestId: 'first', patch: { markdown: 'A' } });
  // The parent posts this snapshot, then the iframe receives another key before delivery.
  const inTransit = { state: { markdown: 'A' }, receipts: ['first'] };
  view.add({ requestId: 'second', patch: { markdown: 'AB' } });
  assert.deepEqual(view.receive(inTransit.state, inTransit.receipts), { markdown: 'AB' });
});

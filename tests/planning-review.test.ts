import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlanningReview, createPlanningObserver, readPlanningReceipt, savePlanningReceipt } from '../src/onboarding/planning-review';

test('optional review observations count transitions without persisting private content or duplicating return baselines', () => {
  const values = new Map<string, string>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key) } });
  try {
    const [brief, guide, timer] = createPlanningReview('private-actor', { x: 40, y: 30 });
    assert.equal(timer.data.endsAt, null);
    assert.equal(timer.data.remainingMs, 300000);
    assert.match(String(guide.data.text), /Return here/);
    let now = 20;
    const observer = createPlanningObserver(null, () => now);
    let receipt = observer.observe([brief]);
    assert.equal(receipt.artifacts, 1);
    brief.data.state = { 'action:private-id': { text: 'Private action text', createdBy: 'private-actor' }, 'status:private-id': 'To do' };
    receipt = observer.observe([brief]);
    assert.equal(receipt.corrections, 0);
    now = 80;
    brief.data.state = { 'action:private-id': { text: 'Corrected private action', createdBy: 'private-actor' }, 'status:private-id': 'Done' };
    receipt = observer.observe([brief]);
    assert.equal(receipt.corrections, 1);
    assert.equal(receipt.reportedDone, 1);
    assert.equal(receipt.firstCorrectionMs, 60);
    savePlanningReceipt('room', receipt);
    const serialized = [...values.values()][0];
    assert.doesNotMatch(serialized, /private|Corrected|action:|createdBy/);
    const returning = createPlanningObserver(readPlanningReceipt('room'), () => 200);
    const returned = returning.observe([brief]);
    assert.equal(returned.returns, 1);
    assert.equal(returned.joins, 2);
    assert.equal(returned.artifacts, 1);
    assert.equal(returned.corrections, 1);
    assert.equal(returned.reportedDone, 1);
    savePlanningReceipt('room', null);
    assert.equal(readPlanningReceipt('room'), null);
    values.set('present:planning-observations:room', serialized.replace('"joins":1', '"joins":1000'));
    assert.equal(readPlanningReceipt('room'), null);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

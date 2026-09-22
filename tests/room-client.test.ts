import assert from 'node:assert/strict';
import test from 'node:test';
import { getParticipantId } from '../src/identity';

test('participant identity survives reconnect and reload within a tab, while new tabs receive their own identity', () => {
  const tab = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };
  const firstTab = tab();
  const id = getParticipantId(firstTab);
  assert.equal(getParticipantId(firstTab), id);
  assert.equal(getParticipantId({ ...firstTab }), id);
  assert.notEqual(getParticipantId(tab()), id);
  firstTab.setItem('present:member-id', 'invalid identity');
  assert.notEqual(getParticipantId(firstTab), 'invalid identity');
});

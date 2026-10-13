import assert from 'node:assert/strict';
import test from 'node:test';
import { providerUnavailableReason, readProviderPreference, type ProviderAvailability } from '../shared/agent-models';
const available: ProviderAvailability = { id: 'sol', name: 'Sol', model: 'gpt-6.1-sol', configured: true, reasoning: ['high'], fast: false };
test('stored retired preferences remain visible and unavailable until an explicit current choice', () => {
  for (const id of ['spark', 'terra'] as const) {
    assert.equal(readProviderPreference(id), id);
    assert.match(providerUnavailableReason(id, [available]) ?? '', /Choose.*explicitly/);
  }
  assert.equal(readProviderPreference(null), undefined);
  assert.equal(readProviderPreference('not-a-model'), undefined);
  assert.equal(readProviderPreference('sol'), 'sol');
  assert.equal(providerUnavailableReason('sol', [available]), undefined);
});
test('a current but unavailable stored preference is never silently substituted', () => {
  assert.equal(readProviderPreference('luna'), 'luna');
  assert.match(providerUnavailableReason('luna', [available]) ?? '', /unavailable/);
  assert.equal(providerUnavailableReason('luna', [{ ...available, id: 'luna', configured: false, reason: 'Project access denied.' }]), 'Project access denied.');
  assert.equal(providerUnavailableReason('luna', []), undefined);
});

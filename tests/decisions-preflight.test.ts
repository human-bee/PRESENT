import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayDecisionsPreflight } from '../scripts/benchmarks/decisions-preflight';
test('public Jev receipts replay through accepted gate with honest raw-versus-gated results and zero paid calls', async () => {
  const result = await replayDecisionsPreflight();
  assert.equal(result.samples, 20); assert.equal(result.rawRouteMatches, 18); assert.equal(result.gatedPlanMatches, 20);
  assert.equal(result.acceptedPlans, 8); assert.equal(result.deferPlans, 12); assert.equal(result.incorrectAcceptedPlans, 0); assert.equal(result.paidRequests, 0);
});

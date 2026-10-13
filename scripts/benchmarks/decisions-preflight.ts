import { readFileSync } from 'node:fs';
import { judge, type Questions } from '../../server/agents/choice-judgments';

type Receipt = { sampleId: string; request: { state: unknown; questions: Questions }; response: { model: string; answers: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }> }; expected: { route: string }; observed: { route: string }; latencyMs: number; provenance: { requestSha256: string }; requestSha256: string };
/** Offline replay of public receipts through the literal accepted adapter. No network or env key is used. */
export async function replayDecisionsPreflight() {
  const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/decisions-preflight-20261012.json', import.meta.url), 'utf8')) as { receipts: Receipt[] };
  const previous = globalThis.fetch, key = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'offline-fixture';
  let receipt: Receipt;
  globalThis.fetch = async () => Response.json(receipt.response);
  let rawRouteMatches = 0, gatedPlanMatches = 0, acceptedPlans = 0, incorrectAcceptedPlans = 0;
  try {
    for (const row of fixture.receipts) {
      receipt = row;
      const result = await judge(row.request.state, row.request.questions, 'jev');
      let route = result.get('route') ?? 'defer';
      // Same known-argument requirements used by semantic/reactive composition.
      if (route === 'timer' && !/^d\d+$/.test(result.get('duration') ?? '')) route = 'defer';
      if (route === 'note' && !/^q\d+$/.test(result.get('text') ?? '')) route = 'defer';
      if (route === 'move' && (!/^d\d+$/.test(result.get('distance') ?? '') || !['left', 'right', 'up', 'down'].includes(result.get('direction') ?? ''))) route = 'defer';
      if (route === 'text' && !/^q\d+$/.test(result.get('text') ?? '')) route = 'defer';
      if (route === 'task' && (!/^t\d+$/.test(result.get('task') ?? '') || !['todo', 'doing', 'done'].includes(result.get('status') ?? ''))) route = 'defer';
      if (row.response.answers.route.choice === row.expected.route) rawRouteMatches++;
      if (route === row.expected.route) gatedPlanMatches++;
      if (route !== 'defer') { acceptedPlans++; if (route !== row.expected.route) incorrectAcceptedPlans++; }
      if (route !== row.observed.route) throw new Error(`Offline gated route differs from recorded plan: ${row.sampleId}`);
      if (result.provenance.requestSha256 !== row.requestSha256 || row.provenance.requestSha256 !== row.requestSha256) throw new Error(`Public request hash mismatch: ${row.sampleId}`);
    }
    return { samples: fixture.receipts.length, rawRouteMatches, gatedPlanMatches, acceptedPlans, deferPlans: fixture.receipts.length - acceptedPlans, incorrectAcceptedPlans, paidRequests: 0, caveat: 'Fixed twenty-sample pilot and offline route replay; no deployment accuracy or threshold calibration claim. Argument correctness is recorded in live receipts, not measured by this route-only replay.' };
  } finally { globalThis.fetch = previous; if (key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = key; }
}
if (process.argv[1]?.endsWith('decisions-preflight.ts')) console.log(JSON.stringify(await replayDecisionsPreflight(), null, 2));

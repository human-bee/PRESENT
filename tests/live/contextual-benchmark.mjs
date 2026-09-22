import dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { makeActivity } from '../../shared/activity.ts';
import { appendUtterance } from '../../server/activities/activity-mutations.ts';
import { conversationPlanSchema } from '../../shared/conversation-plan.ts';
import { activityExtractionInstructions, conversationContext, planErrors } from '../../server/activities/interpret-conversation.ts';
import { requestResponse, responseText } from '../../server/activities/response-client.ts';
import { generateWithCodex, closeCodexSession } from '../../server/agents/codex.ts';
if (process.env.PRESENT_LIVE_ROOMOS !== '1') throw new Error('Explicit opt-in required: seven contextual samples per model.');
dotenv.config({ path: process.env.PRESENT_ENV_FILE ?? '.env.local', quiet: true });
const out = `.data/qa/contextual-benchmark-${Date.now()}`; mkdirSync(out, { recursive: true });
function example(kind, text, prior = [], resolved = false) {
  const a = makeActivity(kind, 'alex', 'fixture'); a.seats = [{ actor: 'alex', name: 'Alex', sideId: null }, { actor: 'riley', name: 'Riley', sideId: null }];
  if (kind === 'standup') a.meeting.blockers = [{ id: 'export', title: 'Finish export contract', ownerId: 'alex', status: resolved ? 'resolved' : 'open', resolution: resolved ? { actor: 'alex', at: 1, utteranceId: 'prior', text: 'I finished the export contract.', source: 'owner-statement' } : null, proof: '' }, { id: 'deploy', title: 'Prepare deployment checklist', ownerId: 'alex', status: 'open', resolution: null, proof: '' }];
  if (kind === 'debate' && prior.length) { a.sides = [{ id: 'red', name: 'Red Ferraris', color: 0 }, { id: 'yellow', name: 'Yellow Ferraris', color: 1 }]; }
  for (const [i, p] of prior.entries()) appendUtterance(a, { id: `prior-${i}`, text: p, at: i, source: 'participant-voice', speakerId: 'riley', speakerName: 'Riley', sideId: null });
  appendUtterance(a, { id: 'latest', text, at: 99, source: 'participant-voice', speakerId: 'alex', speakerName: 'Alex', sideId: null }); return { a, u: a.utterances.at(-1) };
}
const question = 'Alex, your export contract is blocking the parser. Is the export contract finished?';
const samples = [
  { name: 'preference-and-visual', ...example('debate', 'I prefer copper pans over stainless steel ones.'), check: p => p.comparisons.length === 1 && p.comparisons[0].subjects.length >= 2 && p.contributions.some(c => c.kind === 'preference' && c.subject) && !p.contributions.some(c => c.kind === 'claim') },
  { name: 'contextual-reference', ...example('debate', 'Yellow is more fun. That one feels like summer.', ['I prefer red Ferraris over yellow ones.']), check: p => p.contributions.some(c => c.kind === 'preference' && ['yellow','Yellow Ferraris'].includes(c.subject)) },
  { name: 'owner-completion', ...example('standup', 'Oh I actually completed that yesterday, that should be unblocked now.', [question]), check: p => p.resolutions.some(r => r.blockerId === 'export' && r.intent === 'completed' && r.grounding === 'speaker') },
  { name: 'negation', ...example('standup', 'No, I did not complete the export contract. It is still blocked.', [question]), check: p => !p.resolutions.some(r => r.intent === 'completed' && r.grounding === 'speaker') },
  { name: 'hypothetical', ...example('standup', 'If I finished that tomorrow, the parser could start. But I have not done it.', [question]), check: p => !p.resolutions.some(r => r.intent === 'completed' && r.grounding === 'speaker') },
  { name: 'reported-quotation', ...example('standup', 'Riley said, I completed that yesterday. Those were Riley’s words, not my status.', [question]), check: p => !p.resolutions.some(r => r.intent === 'completed' && r.grounding === 'speaker') },
  { name: 'retraction', ...example('standup', 'Wait, I was wrong. The export contract is not finished after all.', [question], true), check: p => p.resolutions.some(r => r.blockerId === 'export' && r.intent === 'retracted' && r.grounding === 'speaker') },
];
const results = [];
try {
  for (const sample of samples) for (const provider of ['luna-priority', 'spark']) {
    const started = performance.now();
    try {
      const input = conversationContext(sample.a, sample.u); let rawText, model, serviceTier;
      if (provider === 'spark') { model = 'gpt-5.3-codex-spark'; serviceTier = 'not reported'; rawText = await generateWithCodex(JSON.stringify(input), AbortSignal.timeout(60000), 'spark', { instructions: activityExtractionInstructions, outputSchema: z.toJSONSchema(conversationPlanSchema) }); }
      else { const raw = await requestResponse({ instructions: activityExtractionInstructions, input: JSON.stringify(input), max_output_tokens: 3500, text: { format: { type: 'json_schema', name: 'room_context', strict: true, schema: z.toJSONSchema(conversationPlanSchema) } } }, AbortSignal.timeout(60000)); rawText = responseText(raw); model = raw.model; serviceTier = raw.service_tier; }
      const plan = conversationPlanSchema.parse(JSON.parse(rawText)), structuralErrors = planErrors(sample.a, sample.u, plan);
      results.push({ sample: sample.name, provider, model, serviceTier, elapsedMs: performance.now()-started, quality: structuralErrors.length === 0 && Boolean(sample.check(plan)), structuralErrors, plan });
    } catch (error) { results.push({ sample: sample.name, provider, elapsedMs: performance.now()-started, quality: false, error: error.message }); }
    writeFileSync(`${out}/results.json`, JSON.stringify({ boundary: 'Seven distinct synthetic contextual samples per path, one observation each. Request start to complete structured plan, no UI or audio in this benchmark. No repair retry and no p95/universal winner claim. Authorization remains independently gated in the app.', results }, null, 2)); console.log(JSON.stringify({ ...results.at(-1), plan: undefined }));
  }
} finally { await closeCodexSession(); }
console.log(out);

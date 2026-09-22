import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { extractionSchema, activityExtractionInstructions } from '../../server/activities/providers.ts';
import { generateWithCodex, closeCodexSession } from '../../server/agents/codex.ts';

if (process.env.PRESENT_LIVE_ROOMOS !== '1') throw new Error('Set PRESENT_LIVE_ROOMOS=1 for this bounded six-call comparison.');
dotenv.config({ path: process.env.PRESENT_ENV_FILE ?? '.env.local', quiet: true });
const inputs = ['A truss bridge uses connected triangles to distribute loads through its structure.', 'Would an arch bridge work better here?', 'For the same volume, steel weighs more than aluminum.'];
const results = [];
const directory = `docs/evidence/roomos-benchmark-${Date.now()}`; await mkdir(directory, { recursive: true });
try {
  for (const [index, utterance] of inputs.entries()) for (const provider of ['luna-priority', 'spark']) {
    const started = performance.now();
    try {
      const input = JSON.stringify({ activity: 'debate', topic: 'Bridge structures', latestUtterance: utterance }); let output, model, servedTier = 'not reported by Codex adapter';
      if (provider === 'spark') { model = 'gpt-5.3-codex-spark'; output = await generateWithCodex(input, AbortSignal.timeout(60000), 'spark', { instructions: activityExtractionInstructions, outputSchema: z.toJSONSchema(extractionSchema) }); }
      else {
        model = 'gpt-5.6-luna'; const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, service_tier: 'priority', reasoning: { effort: 'none' }, store: false, instructions: activityExtractionInstructions, input, max_output_tokens: 1500, text: { format: { type: 'json_schema', name: 'ambient_claims', strict: true, schema: z.toJSONSchema(extractionSchema) } } }) });
        if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
        const raw = await response.json(); if (raw.status !== 'completed') throw new Error('Incomplete provider output'); servedTier = raw.service_tier; model = raw.model;
        output = raw.output.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('');
      }
      const parsed = extractionSchema.parse(JSON.parse(output)), valid = parsed.claims.every(c => utterance.includes(c.quote)) && (index === 1 ? parsed.claims.length === 0 : parsed.claims.length > 0);
      results.push({ input: utterance, provider, model, reasoning: provider === 'spark' ? 'low' : 'none', servedTier, elapsedMs: performance.now() - started, valid, output: parsed });
    } catch (error) { results.push({ input: utterance, provider, elapsedMs: performance.now() - started, valid: false, error: error instanceof Error ? error.message : String(error) }); }
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(`${directory}/results.json`, JSON.stringify({ boundary: 'Request start to complete validated extraction JSON; includes Codex process/session setup when cold. Three varied synthetic inputs per provider, no latency distribution claim and no speech capture in this benchmark.', results }, null, 2));
  }
} finally { await closeCodexSession(); }
console.log(directory);

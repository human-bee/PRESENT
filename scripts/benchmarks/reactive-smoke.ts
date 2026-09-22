import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
const file = 'docs/benchmarks/reactive-' + new Date().toISOString().replaceAll(':', '-') + '.jsonl';
const started = Date.now();
const engines = process.argv.includes('--cerebras') ? ['jev', 'cerebras', 'luna'] : ['jev', 'luna'];
const interval = process.argv.includes('--quick') ? 0 : 66000;
const log = (data: unknown) => { const line = JSON.stringify(data); appendFileSync(file, line + '\n'); console.log(line); };
log({ type: 'start', at: started, interval, engines, roles: 'Three synthetic participants per story; not real humans', debateInput: 'Explicit contribution form; other turns use the command interpreter', metric: 'HTTP round trip through model and authoritative document commit; not paint' });
for (let step = 0; step < 6; step++) {
  const wait = started + step * interval - Date.now(); if (wait > 0) await setTimeout(wait);
  for (let story = 0; story < 2; story++) for (const engine of engines) {
    const began = performance.now();
    try {
      const response = await fetch('http://127.0.0.1:4317/api/benchmark/reactive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine, story, step }), signal: AbortSignal.timeout(60000) });
      const data = await response.json();
      const { observed, ...result } = data;
      log({ engine, story, step, ...result, status: response.status, httpMs: Math.round(performance.now() - began), observedState: observed?.data?.state, observedText: observed?.data?.text, observedX: observed?.x, observedY: observed?.y, observedColor: observed?.data?.color });
    } catch (error) { log({ engine, story, step, error: String(error) }); }
  }
}
log({ type: 'complete', durationMs: Date.now() - started });
console.log(file);

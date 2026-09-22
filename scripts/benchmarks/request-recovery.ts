import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestJournal } from '../../server/agents/request-journal';

const directory = mkdtempSync(join(tmpdir(), 'present-recovery-benchmark-'));
const count = 100, fresh: number[] = [], replay: number[] = [];
let executions = 0;
const percentile = (values: number[], p: number) => Number([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1].toFixed(3));
try {
  for (let pass = 0; pass < 2; pass++) {
    const journal = new RequestJournal({ directory });
    for (let index = 0; index < count; index++) {
      const started = performance.now();
      const result = await journal.run({ roomId: 'b'.repeat(32), actor: 'benchmark-fixture', requestId: `sample-${index}` }, { fixture: index }, async () => {
        executions++; return { objectIds: [`fixture-${index}`], provider: 'fixture', elapsedMs: 0 };
      });
      if (result.replayed !== Boolean(pass)) throw new Error('Unexpected replay result.');
      (pass ? replay : fresh).push(performance.now() - started);
    }
  }
  console.log(JSON.stringify({ boundary: 'local durable request metadata; no model, network or browser', samplesPerPass: count, executions,
    fresh: { medianMs: percentile(fresh, .5), p95Ms: percentile(fresh, .95) }, recovered: { medianMs: percentile(replay, .5), p95Ms: percentile(replay, .95) },
    replayedWithoutExecution: count }, null, 2));
} finally { rmSync(directory, { recursive: true, force: true }); }

import { performance } from 'node:perf_hooks';
import { exportRoomTemplate, instantiateRoomTemplate } from '../../shared/room-template';
import { builtInTemplates } from './catalog';
/** Fixed 100-object workload, deterministic IDs/time, no providers or IO. Timing is host-dependent. */
export function runTemplateBenchmark() {
  const base = builtInTemplates.get('builtin-brainstorm')!;
  const page = base.records.find(r => r.typeName === 'page')!;
  const shapes = base.records.filter(r => r.typeName === 'shape');
  const records = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(shapes[i % shapes.length]), id: `shape:bench_${i}`, x: (i % 10) * 400, y: Math.floor(i / 10) * 300 }));
  const template = exportRoomTemplate([page, ...records] as typeof base.records, 'Benchmark');
  let serial = 0;
  const run = () => instantiateRoomTemplate(template, { id: () => `bench_${serial++}`, now: 0 });
  for (let i = 0; i < 3; i++) run();
  const samples: number[] = [], start = performance.now(); let instanceBytes = 0;
  for (let i = 0; i < 20; i++) { const before = performance.now(); const result = run(); samples.push(performance.now() - before); instanceBytes = Buffer.byteLength(JSON.stringify(result)); }
  samples.sort((a, b) => a - b);
  return { objects: 100, iterations: 20, templateBytes: Buffer.byteLength(JSON.stringify(template)), instanceBytes, p95Ms: samples[18], totalMs: performance.now() - start };
}

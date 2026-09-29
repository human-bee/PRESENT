import { DocumentRecordType, type TLAsset } from '@tldraw/tlschema';
import { makeObject } from '../../shared/room';
import { objectToShape, recordsToRoom } from '../../shared/tldraw-adapter';
import { createRoomProjection } from '../../src/tldraw/room-projection';

const document = DocumentRecordType.create({ name: 'Synthetic performance room' });
const shapes = Array.from({ length: 500 }, (_, i) => objectToShape(makeObject(i < 50 ? 'ink' : 'widget', 'benchmark', { x: i % 20 * 300, y: Math.floor(i / 20) * 250 },
  i < 50 ? { points: Array.from({ length: 200 }, (_, p) => [p, Math.sin(p / 10) * 50]) } : { state: { count: i }, html: '<button>Shared control</button>' })));
const assets: TLAsset[] = [];
const project = createRoomProjection('benchmark');
project(shapes, assets, document);
function measure(run: (i: number) => unknown) {
  for (let i = 0; i < 20; i++) run(i);
  const times = Array.from({ length: 500 }, (_, i) => { const start = performance.now(); run(i); return performance.now() - start; }).sort((a, b) => a - b);
  return { p50Ms: times[249], p95Ms: times[474], maxMs: times[499] };
}
const pointer = { before: measure(() => recordsToRoom('benchmark', [document, ...shapes])), after: measure(() => project(shapes, assets, document)) };
const changes = Array.from({ length: 520 }, (_, i) => shapes.map((shape, n) => n === 200 ? { ...shape, x: i } : shape));
const drag = { before: measure(i => recordsToRoom('benchmark', [document, ...changes[i]])), after: measure(i => project(changes[i], assets, document)) };
console.log(JSON.stringify({ shapes: shapes.length, strokePoints: 10000, iterations: 500, pointer, drag,
  scope: 'Node CPU microbenchmark of derived room state, not browser rendering, network or speech latency.' }, null, 2));

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIndexAbove, type IndexKey } from '@tldraw/utils';
import { makeObject } from '../../shared/room';
import { objectToShape } from '../../shared/tldraw-adapter';
import { RoomStore } from '../../server/room-store';

const directory = mkdtempSync(join(tmpdir(), 'present-room-read-'));
const store = new RoomStore({ directory });
const roomId = 'c'.repeat(32), count = 200, samples = 100;
const percentile = (values: number[], p: number) => Number([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1].toFixed(3));
try {
  let index: IndexKey | undefined;
  const creates = Array.from({ length: count }, (_, n) => {
    index = getIndexAbove(index);
    return objectToShape(makeObject('note', 'benchmark', { x: (n % 20) * 230, y: Math.floor(n / 20) * 230 }, { text: `Fixture ${n}` }), { index });
  });
  store.mutateCanvas(roomId, { creates }, 'benchmark');
  const reads: number[] = [], sweeps: number[] = [];
  for (let n = 0; n < samples; n++) {
    let start = performance.now();
    if (store.getRoom(roomId).objects.length !== count) throw new Error('Fixture objects changed.');
    reads.push(performance.now() - start);
    start = performance.now(); store.sweepExpired(); sweeps.push(performance.now() - start);
  }
  console.log(JSON.stringify({ boundary: 'server room projection and expiry scan; no network or model', objects: count, samples,
    read: { medianMs: percentile(reads, .5), p95Ms: percentile(reads, .95) },
    sweep: { medianMs: percentile(sweeps, .5), p95Ms: percentile(sweeps, .95) } }, null, 2));
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }

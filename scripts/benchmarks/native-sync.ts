/** Real loopback WebSocket delivery; excludes browser rendering and providers. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { attachRoomSocket } from '../../server/room-socket';
import { RoomStore } from '../../server/room-store';
import { CAPABILITIES } from '../../shared/capabilities';
import { createCapability } from '../../src/widgets/packs';
import { createStarter } from '../../src/widgets/presets';
import { presentSchema } from '../../shared/tldraw-schema';
import type { Operation } from '../../shared/room';

const directory = mkdtempSync(join(tmpdir(), 'present-sync-benchmark-'));
const store = new RoomStore({ directory, debounceMs: 150 });
const server = createServer();
const roomId = 'c'.repeat(32), sockets: WebSocket[] = [];
const boundedCount = (name: string, fallback: number, max: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${name} must be an integer between 0 and ${max}.`);
  return value;
};
const rounds = boundedCount('PRESENT_BENCH_ROUNDS', 200, 5000);
const backgroundNotes = boundedCount('PRESENT_BENCH_NOTES', 0, 1000);
const samples: Record<string, number[]> = { create: [], move: [], sharedState: [] };
type Message = { type: string; diff?: Record<string, unknown> };
function reader(socket: WebSocket) {
  const pending: Message[] = [], listeners = new Set<() => void>();
  socket.on('message', raw => {
    const value = JSON.parse(raw.toString());
    pending.push(...(value.type === 'data' ? value.data : [value]));
    for (const notify of listeners) notify();
  });
  return (match: (message: Message) => boolean) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Native delivery exceeded 2 seconds')); }, 2000);
    function check() {
      const index = pending.findIndex(match);
      if (index < 0) return;
      pending.splice(index, 1); clearTimeout(timer); listeners.delete(check); resolve();
    }
    listeners.add(check); check();
  });
}
let closeSockets = () => {};
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  closeSockets = attachRoomSocket(server, port, { getTldrawRoom: store.getTldrawRoom.bind(store) });
  const peers = await Promise.all(Array.from({ length: 4 }, async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/connect?room=${roomId}&sessionId=${randomUUID()}`, { origin: `http://127.0.0.1:${port}` });
    sockets.push(socket); const read = reader(socket); await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'connect', connectRequestId: randomUUID(), lastServerClock: 0, protocolVersion: 8, schema: presentSchema.serialize() }));
    await read(message => message.type === 'connect');
    return read;
  }));
  const apply = async (name: string, id: string, operation: Operation) => {
    const delivered = Promise.all(peers.map(read => read(message => message.type === 'patch' && Boolean(message.diff?.[`shape:${id}`]))));
    const start = performance.now();
    store.applyOperation(roomId, operation, 'benchmark', { requestId: randomUUID() });
    await delivered;
    samples[name].push(performance.now() - start);
  };
  const objects = [
    ...(['note', 'timer', 'teleprompter', 'poll', 'synth'] as const).map(kind => createStarter(kind, 'benchmark', { x: 0, y: 0 })),
    ...CAPABILITIES.map(item => createCapability(item.kind, 'benchmark', { x: 0, y: 0 })),
  ];
  for (let index = 0; index < backgroundNotes; index++) {
    const note = createStarter('note', 'benchmark-history', { x: index % 20 * 300, y: Math.floor(index / 20) * 250 });
    store.applyOperation(roomId, { type: 'put', object: note }, 'benchmark-history');
  }
  for (const object of objects) await apply('create', object.id, { type: 'put', object });
  const widget = objects.find(object => object.title === 'A room pulse')!;
  for (let index = 1; index <= rounds; index++) {
    const object = objects[index % objects.length];
    await apply('move', object.id, { type: 'patch', id: object.id, patch: { x: index * 3, y: index * 2 } });
    await apply('sharedState', widget.id, { type: 'patch', id: widget.id, patch: { data: { state: { benchmarkCounter: index } } } });
  }
  assert.equal(store.getRoom(roomId).objects.length, objects.length + backgroundNotes);
  if (rounds) assert.equal((store.getRoom(roomId).objects.find(object => object.id === widget.id)!.data.state as Record<string, unknown>).benchmarkCounter, rounds);
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { actions: values.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1), belowOneSecond: values.filter(ms => ms < 1000).length };
  };
  console.log(JSON.stringify({ boundary: 'Server operation start through receipt of native WebSocket patch by all four loopback peers. No browser, acoustic audio or provider time.', peers: peers.length, objects: objects.length + backgroundNotes, rounds, categories: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, stats(values)])) }, null, 2));
} finally {
  for (const socket of sockets) socket.terminate(); closeSockets();
  await new Promise<void>(resolve => server.close(() => resolve()));
  store.close(); rmSync(directory, { recursive: true, force: true });
}

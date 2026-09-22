import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { attachRoomSocket } from '../server/room-socket';
import { RoomStore } from '../server/room-store';
import { makeObject } from '../shared/room';
import { objectToShape } from '../shared/tldraw-adapter';
import { presentSchema } from '../shared/tldraw-schema';

type Message = { type: string; [key: string]: unknown };
function reader(socket: WebSocket) {
  const messages: Message[] = [], listeners = new Set<() => void>();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    messages.push(...(message.type === 'data' ? message.data : [message]));
    for (const listener of listeners) listener();
  });
  return (predicate: (message: Message) => boolean) => new Promise<Message>((resolve, reject) => {
    const timeout = setTimeout(() => { listeners.delete(check); reject(new Error('Expected native sync message was not received.')); }, 5000);
    function check() {
      const index = messages.findIndex(predicate);
      if (index < 0) return;
      clearTimeout(timeout); listeners.delete(check); resolve(messages.splice(index, 1)[0]);
    }
    listeners.add(check); check();
  });
}

test('native tldraw clients and server agents share one document across reconnects and isolated rooms', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-native-socket-'));
  const store = new RoomStore({ directory, debounceMs: 100_000 }), server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const closeSockets = attachRoomSocket(server, port, { getTldrawRoom: store.getTldrawRoom.bind(store) });
  const sockets: WebSocket[] = [];
  const connect = async (room: string, sessionId: string = randomUUID()) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/connect?room=${room}&sessionId=${sessionId}`, { origin: `http://127.0.0.1:${port}` });
    sockets.push(socket);
    const read = reader(socket);
    await once(socket, 'open');
    // The pinned tldraw 5.4.0 wire protocol is version 8.
    socket.send(JSON.stringify({ type: 'connect', connectRequestId: randomUUID(), lastServerClock: 0, protocolVersion: 8, schema: presentSchema.serialize() }));
    const snapshot = await read(message => message.type === 'connect');
    return { socket, read, snapshot, sessionId };
  };
  try {
    const room = 'a'.repeat(32), a = await connect(room), b = await connect(room);
    const isolated = await connect('b'.repeat(32));
    assert.ok('diff' in a.snapshot);
    assert.equal(store.getTldrawRoom(room).getSessions().filter(session => session.isConnected).length, 2);
    const shape = objectToShape({ ...makeObject('note', 'Alice', { x: 10, y: 20 }, { text: 'Native hello' }), id: 'shared-note' });
    a.socket.send(JSON.stringify({ type: 'push', clientClock: 0, diff: { [shape.id]: ['put', shape] } }));
    await b.read(message => message.type === 'patch' && JSON.stringify(message.diff).includes(shape.id));
    assert.equal(store.getRoom(room).objects[0].data.text, 'Native hello');
    store.applyOperation(room, { type: 'patch', id: 'shared-note', patch: { data: { text: 'From the server agent' } } }, 'agent:spark');
    await b.read(message => message.type === 'patch' && JSON.stringify(message.diff).includes('From the server agent'));
    assert.equal(store.getRoom('b'.repeat(32)).objects.length, 0);
    assert.equal(isolated.snapshot.serverClock, 0);
    a.socket.close(); await once(a.socket, 'close');
    const reconnected = await connect(room, a.sessionId);
    assert.ok(JSON.stringify(reconnected.snapshot.diff).includes('From the server agent'));
    const superseded = once(reconnected.socket, 'close');
    const replacement = await connect(room, a.sessionId);
    assert.equal((await superseded)[0], 1000);
    assert.equal(store.getTldrawRoom(room).getSessions().filter(session => session.isConnected).length, 2);
    replacement.socket.send(JSON.stringify({ type: 'ping' }));
    await replacement.read(message => message.type === 'pong');
  } finally {
    for (const socket of sockets) socket.terminate();
    closeSockets(); await new Promise<void>(resolve => server.close(() => resolve()));
    store.close(); rmSync(directory, { recursive: true, force: true });
  }
});

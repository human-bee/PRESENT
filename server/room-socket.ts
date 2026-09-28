import { JsonChunkAssembler } from '@tldraw/sync-core';
import { type RoomAccess, assertAccessOrigin, sessionToken } from './access';
import { createRoomAuthorization, withRoomAuthorization, type RoomAuthorization } from './access/context';
import { bindPresence } from './access/socket';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getTldrawRoom, validRoomId } from './room-store';
import { isLocalRequest } from './http';

/** Native tldraw wire protocol; presence and document sync belong to TLSocketRoom. */
export function attachRoomSocket(server: Server, port: number, roomStore = { getTldrawRoom }, alpha?: { access: RoomAccess; origin: string }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
  const peers = new Map<string, { socket: WebSocket; room: string; alive: boolean }>();
  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`); } catch { socket.destroy(); return; }
    if (url.pathname !== '/connect') return;
    if (!alpha && !isLocalRequest(request, port)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const roomId = url.searchParams.get('room') ?? '';
    let sessionId = url.searchParams.get('sessionId') ?? '';
    let scope: RoomAuthorization | undefined;
    try {
      if (alpha) {
        assertAccessOrigin(request, alpha.origin, true);
        scope = createRoomAuthorization(alpha.access, sessionToken(request), roomId);
      }
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (!validRoomId(roomId) || !/^[\w:.-]{1,200}$/.test(sessionId)) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    if (scope) sessionId = `${scope.userId}:${sessionId}`;
    const key = `${roomId}:${sessionId}`, previous = peers.get(key);
    if (!previous && (peers.size >= 128 || [...peers.values()].filter(peer => peer.room === roomId).length >= 32)) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    let room: ReturnType<typeof getTldrawRoom>;
    try { room = withRoomAuthorization(scope, () => roomStore.getTldrawRoom(roomId)); } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, connection => {
      previous?.socket.close(1000, 'Session reconnected.');
      const peer = { socket: connection, room: roomId, alive: true };
      peers.set(key, peer);
      // Explicit event wiring permits transport limits before passing native data onward.
      const grant = scope?.check();
      room.handleSocketConnect({ sessionId, isReadonly: grant?.role === 'viewer', objectAccess: grant?.role === 'viewer' ? 'read' : 'write', socket: {
        get readyState() { return connection.readyState; },
        send(data) { try { scope?.check(); } catch { connection.close(1008, 'Room access ended.'); return; } if (connection.bufferedAmount > 2_000_000) connection.terminate(); else if (connection.readyState === WebSocket.OPEN) connection.send(data); },
        close(code, reason) { connection.close(code, reason); },
      } });
      const unwatch = scope?.watch(() => connection.close(1008, 'Room access ended.'));
      connection.once('close', () => unwatch?.());
      const assembler = new JsonChunkAssembler();
      let assembledBytes = 0;
      let windowAt = Date.now(), count = 0, bytes = 0;
      connection.on('message', (data, binary) => {
        if (peers.get(key) !== peer || connection.readyState !== WebSocket.OPEN) return;
        if (Date.now() - windowAt > 1000) { windowAt = Date.now(); count = 0; bytes = 0; }
        bytes += data instanceof Buffer ? data.length : Buffer.byteLength(data.toString());
        if (binary || ++count > 240 || bytes > 4_000_000) { connection.close(1008, 'Transport limits exceeded.'); return; }
        try {
          scope?.check();
          if (!scope) room.handleSocketMessage(sessionId, data.toString());
          else {
            assembledBytes += Buffer.byteLength(data.toString());
            if (assembledBytes > 4_000_000) throw new Error('Message too large');
            const message = assembler.handleMessage(data.toString());
            if (message && 'error' in message) throw message.error;
            if (message && 'stringified' in message) {
              assembledBytes = 0;
              withRoomAuthorization(scope, () => room.handleSocketMessage(sessionId, bindPresence(message.stringified, scope.userId)));
            }
          }
        } catch { connection.close(1008, 'Room access ended or invalid message.'); }
      });
      connection.on('pong', () => { peer.alive = true; });
      connection.on('error', () => { if (peers.get(key) === peer) room.handleSocketError(sessionId); });
      connection.on('close', () => {
        if (peers.get(key) !== peer) return;
        peers.delete(key); room.handleSocketClose(sessionId);
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (!peer.alive) peer.socket.terminate();
      else { peer.alive = false; peer.socket.ping(); }
    }
  }, 30_000);
  heartbeat.unref();
  return () => { clearInterval(heartbeat); for (const peer of peers.values()) peer.socket.terminate(); wss.close(); };
}

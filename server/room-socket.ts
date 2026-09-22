import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getTldrawRoom, validRoomId } from './room-store';
import { isLocalRequest } from './http';

/** Native tldraw wire protocol; presence and document sync belong to TLSocketRoom. */
export function attachRoomSocket(server: Server, port: number, roomStore = { getTldrawRoom }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
  const peers = new Map<string, { socket: WebSocket; room: string; alive: boolean }>();
  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`); } catch { socket.destroy(); return; }
    if (url.pathname !== '/connect') return;
    if (!isLocalRequest(request, port)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const roomId = url.searchParams.get('room') ?? '', sessionId = url.searchParams.get('sessionId') ?? '';
    if (!validRoomId(roomId) || !/^[\w:.-]{1,200}$/.test(sessionId)) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    const key = `${roomId}:${sessionId}`, previous = peers.get(key);
    if (!previous && (peers.size >= 128 || [...peers.values()].filter(peer => peer.room === roomId).length >= 32)) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    let room: ReturnType<typeof getTldrawRoom>;
    try { room = roomStore.getTldrawRoom(roomId); } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, connection => {
      previous?.socket.close(1000, 'Session reconnected.');
      const peer = { socket: connection, room: roomId, alive: true };
      peers.set(key, peer);
      // Explicit event wiring permits transport limits before passing native data onward.
      room.handleSocketConnect({ sessionId, socket: {
        get readyState() { return connection.readyState; },
        send(data) { if (connection.bufferedAmount > 2_000_000) connection.terminate(); else if (connection.readyState === WebSocket.OPEN) connection.send(data); },
        close(code, reason) { connection.close(code, reason); },
      } });
      let windowAt = Date.now(), count = 0, bytes = 0;
      connection.on('message', (data, binary) => {
        if (peers.get(key) !== peer || connection.readyState !== WebSocket.OPEN) return;
        if (Date.now() - windowAt > 1000) { windowAt = Date.now(); count = 0; bytes = 0; }
        bytes += data instanceof Buffer ? data.length : Buffer.byteLength(data.toString());
        if (binary || ++count > 240 || bytes > 4_000_000) { connection.close(1008, 'Transport limits exceeded.'); return; }
        room.handleSocketMessage(sessionId, data.toString());
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

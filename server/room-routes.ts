import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyOperation, getRoom, getRoomSnapshot, RoomError } from './room-store';
import { json } from './http';
import { executeCanvasTool } from './agents/canvas-tools';
import { operationSchema } from '../shared/room';
import { awaitNativeObject } from './await-native-object';

export async function handleRoomRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = /^\/api\/room\/([a-f0-9]{24,64})(\/(?:operation|canvas|document))?$/.exec(url.pathname);
  if (!match) return false;
  const roomId = match[1];
  if (!match[2] && req.method === 'GET') { json(res, 200, { room: getRoom(roomId) }); return true; }
  if (match[2] === '/document' && req.method === 'GET') { json(res, 200, { roomId, snapshot: getRoomSnapshot(roomId) }); return true; }
  if (!match[2] || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed.' }); return true; }
  const parts: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) {
    const part = Buffer.from(chunk); bytes += part.length;
    if (bytes > 80_000) throw new RoomError('This operation is too large.', 413);
    parts.push(part);
  }
  let input: { operation?: unknown; args?: unknown; name?: unknown; actor?: unknown; requestId?: unknown };
  try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new RoomError('Invalid JSON request.'); }
  if (!input || typeof input.actor !== 'string' || typeof input.requestId !== 'string') throw new RoomError('Operation identity is required.');
  if (match[2] === '/canvas') {
    if (input.name !== 'read_canvas' && input.name !== 'apply_canvas') throw new RoomError('Unknown canvas command.');
    json(res, 200, await executeCanvasTool(roomId, input.actor, input.name, input.args, input.requestId));
    return true;
  }
  const parsed = operationSchema.safeParse(input.operation);
  if (!parsed.success) throw new RoomError('Invalid room operation.');
  if ('id' in parsed.data) {
    const controller = new AbortController(), abort = () => controller.abort();
    res.on('close', abort);
    try { await awaitNativeObject(roomId, parsed.data.id, controller.signal); }
    finally { res.off('close', abort); }
    if (controller.signal.aborted) return true;
  }
  const room = applyOperation(roomId, parsed.data, input.actor, { requestId: input.requestId });
  json(res, 200, { room, receipt: { status: 'committed', revision: room.revision, requestId: input.requestId } });
  return true;
}

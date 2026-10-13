import type { IncomingMessage, ServerResponse } from 'node:http';
import { continuityApplyRequestSchema, continuityPreviewRequestSchema } from '../../shared/room-continuity';
import { json } from '../http';
import type { RoomAccess } from '../access/store';
import { AccessError } from '../access/store';
import { sessionToken } from '../access/http';
import { createRoomAuthorization, withRoomAuthorization } from '../access/context';
import { flushRoomStore, getCanvasRecords, getTldrawRoom } from '../room-store';
import { installTemplateRecords } from '../templates/install';
import { continuityRecords, previewContinuity, selectedContinuity } from './content';

export async function hostedContinuity(access: RoomAccess, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!['/api/templates/continuity/preview', '/api/templates/continuity/apply'].includes(path)) return false;
  try {
    const token = sessionToken(req); access.identity(token);
    if (req.method !== 'POST') { json(res, 405, { error: 'Use POST for selective continuity.' }); return true; }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new AccessError('JSON required.', 415);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 80000) throw new AccessError('Continuity request exceeds 80 KB.', 413); chunks.push(bytes); }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const input = path.endsWith('/preview') ? continuityPreviewRequestSchema.parse(raw) : continuityApplyRequestSchema.parse(raw);
    const readSource = () => {
      access.authorize(token, input.sourceRoomId, 'read');
      return withRoomAuthorization(createRoomAuthorization(access, token, input.sourceRoomId), () => getCanvasRecords(input.sourceRoomId));
    };
    const source = readSource();
    if (path.endsWith('/preview')) { json(res, 200, previewContinuity(input.sourceRoomId, source)); return true; }
    const apply = continuityApplyRequestSchema.parse(raw);
    selectedContinuity(apply, source);
    const destination = apply.destinationRoomId ?? access.createRoom(token).roomId;
    if (destination === input.sourceRoomId) throw new AccessError('Carry selected content into a different fresh room.', 409);
    access.authorize(token, destination, 'write');
    const records = continuityRecords(apply, source);
    await withRoomAuthorization(createRoomAuthorization(access, token, destination), () => installTemplateRecords(getTldrawRoom(destination), records, () => {
      access.authorize(token, destination, 'write');
      selectedContinuity(apply, readSource()); // Recheck membership AND selected source content at the destination commit barrier.
    }));
    flushRoomStore();
    json(res, 201, { roomId: destination, count: apply.selection.length });
  } catch (error) {
    json(res, error instanceof AccessError ? error.status : 409, { error: error instanceof AccessError ? error.message : error instanceof Error && /source content|Select each|Destination room/.test(error.message) ? error.message : 'Continuity could not be applied. Check the selection and use a fresh unused destination room.' });
  }
  return true;
}

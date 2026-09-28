import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTemplateRequestHandler } from '../template-routes';
import { TemplateCatalog } from '../templates/catalog';
import { installTemplateRecords } from '../templates/install';
import { getCanvasRecords, getTldrawRoom } from '../room-store';
import { dataPath } from '../data-path';
import type { RoomAccess } from './store';
import { sessionToken } from './http';
import { createRoomAuthorization, withRoomAuthorization } from './context';
export function hostedTemplates(access: RoomAccess, req: IncomingMessage, res: ServerResponse) {
  const token = sessionToken(req), identity = access.identity(token);
  let sourceRoom: string | undefined;
  const handler = createTemplateRequestHandler({
    catalog: new TemplateCatalog(join(dataPath('templates'), 'users', identity.userId)),
    check: () => { access.identity(token); if (sourceRoom) access.authorize(token, sourceRoom, 'invite'); },
    readRoom: roomId => {
      sourceRoom = roomId;
      access.authorize(token, roomId, 'invite'); // Owner export; whitelist still applies.
      return withRoomAuthorization(createRoomAuthorization(access, token, roomId), () => getCanvasRecords(roomId));
    },
    reserveRoom: () => access.createRoom(token).roomId,
    installRoom: (roomId, records) => withRoomAuthorization(createRoomAuthorization(access, token, roomId), async () => {
      access.authorize(token, roomId, 'write');
      // updateStore callback is synchronous after its read barrier; recheck inside the commit too.
      const room = getTldrawRoom(roomId);
      await installTemplateRecords(room, records, () => { access.authorize(token, roomId, 'write'); });
    }),
  });
  return handler(req, res);
}

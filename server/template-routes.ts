import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLRecord } from '@tldraw/tlschema';
import { z } from 'zod';
import { exportRoomTemplate, instantiateRoomTemplate, type TemplateInstallation } from '../shared/room-template';
import { json } from './http';
import { TemplateCatalog } from './templates/catalog';

export type TemplateRoutePorts = {
  catalog: TemplateCatalog;
  /** Host applies its room authorization policy before returning records. */
  readRoom: (roomId: string) => readonly TLRecord[] | Promise<readonly TLRecord[]>;
  /** Commit all records atomically to a NEW room, rejecting an existing destination. */
  installRoom: (roomId: string, records: TLRecord[]) => void | Promise<void>;
};
const save = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), name: z.string().trim().min(1).max(80) }).strict();
export function createTemplateRequestHandler(ports: TemplateRoutePorts) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const match = /^\/api\/templates(?:\/([a-z0-9-]+)(\/instantiate)?)?$/.exec(path);
    if (!match) return false;
    try {
      if (req.method === 'GET' && !match[2]) {
        const value = match[1] ? ports.catalog.get(match[1]) : ports.catalog.list();
        json(res, value ? 200 : 404, value ?? { error: 'Template not found.' }); return true;
      }
      if (req.method !== 'POST' || (match[1] && !match[2])) { json(res, 405, { error: 'Method not allowed.' }); return true; }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) { const b = Buffer.from(chunk); bytes += b.length; if (bytes > 4096) { json(res, 413, { error: 'Request exceeds 4 KB.' }); return true; } chunks.push(b); }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!match[1]) {
        const input = save.parse(body);
        const result = ports.catalog.save(exportRoomTemplate(await ports.readRoom(input.roomId), input.name));
        json(res, 201, result); return true;
      }
      z.object({}).strict().parse(body);
      const template = ports.catalog.get(match[1]);
      if (!template) { json(res, 404, { error: 'Template not found.' }); return true; }
      const instance = instantiateRoomTemplate(template), roomId = randomBytes(16).toString('hex');
      await ports.installRoom(roomId, instance.records);
      json(res, 201, { roomId, notices: instance.notices } satisfies TemplateInstallation);
    } catch { json(res, 400, { error: 'Template operation failed. Check the room, template and server capacity.' }); }
    return true;
  };
}

import { join } from 'node:path';
import { requireRoomAuthorization, roomAuthorization, inviteAuthorizationEnforced } from './context';
import { AccessError } from './store';
const namePattern = '[a-f0-9]{64}\\.(?:png|jpg|gif|webp|avif|mp4|webm|mov)';
export function scopedAssetDirectory(base: string, roomId?: string) {
  if (!roomAuthorization()) { if (inviteAuthorizationEnforced()) throw new AccessError('Missing room asset authorization.'); return base; }
  const room = roomId ?? roomAuthorization()!.roomId;
  requireRoomAuthorization(room, 'asset:write');
  return join(base, 'rooms', room);
}
export function storedAssetURL(name: string, roomId?: string) {
  const scope = roomAuthorization();
  if (!scope) { if (inviteAuthorizationEnforced()) throw new AccessError('Missing room asset authorization.'); return `/api/assets/${name}`; }
  const room = roomId ?? scope.roomId;
  requireRoomAuthorization(room, 'asset:write');
  return `/api/assets/${room}/${name}`;
}
export function referenceAsset(src: string, base: string, roomId: string): { directory: string; name: string } | undefined {
  const scoped = new RegExp(`^/api/assets/([a-f0-9]{48})/(${namePattern})$`).exec(src);
  if (scoped) {
    if (scoped[1] !== roomId) throw new AccessError('The image belongs to another room.');
    requireRoomAuthorization(roomId, 'asset:read');
    return { directory: join(base, 'rooms', roomId), name: scoped[2] };
  }
  if (inviteAuthorizationEnforced()) throw new AccessError('This image has no private room association.');
  return undefined;
}

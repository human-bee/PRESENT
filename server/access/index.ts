import { RoomAccess } from './store';
import { createAccessHandler } from './http';
export { RoomAccess, AccessError } from './store';
export { assertAccessOrigin, authorizationPath, authorizeRequest, createAccessHandler, sessionToken, watchAuthorization } from './http';
/** Opt-in only. Does not change bind address, Host/Origin checks, or sandbox policy. */
export function configuredAccess(env: NodeJS.ProcessEnv = process.env) {
  if (env.PRESENT_ACCESS_MODE === undefined || env.PRESENT_ACCESS_MODE === 'local') return undefined;
  if (env.PRESENT_ACCESS_MODE !== 'invite') throw new Error('Unknown PRESENT_ACCESS_MODE.');
  const secret = env.PRESENT_ACCESS_SECRET, origin = env.PRESENT_ACCESS_ORIGIN, directory = env.PRESENT_ACCESS_DIRECTORY;
  if (!secret || !origin || !directory) throw new Error('Invite mode requires PRESENT_ACCESS_SECRET, PRESENT_ACCESS_ORIGIN and PRESENT_ACCESS_DIRECTORY.');
  const access = new RoomAccess({ secret, directory });
  try { return { access, origin, handleRequest: createAccessHandler(access, origin) }; }
  catch (error) { access.close(); throw error; }
}

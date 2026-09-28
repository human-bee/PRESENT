import { AccessError } from './store';
/** Native protocol presence is client-authored by default. Pin it to the signed identity.
 * Diff tuple opcodes match @tldraw/sync-core 5.4.0 RecordOpType/ValueOpType.
 */
export function bindPresence(data: string, userId: string): string {
  const message = JSON.parse(data);
  if (message.type === 'push' && message.presence) {
    const [op, presence] = message.presence;
    if (!presence || typeof presence !== 'object' || Array.isArray(presence)) throw new AccessError('Invalid presence.');
    if (op === 'put') presence.userId = `user:${userId}`;
    else if (op === 'patch') presence.userId = ['put', `user:${userId}`];
    else throw new AccessError('Invalid presence.');
  }
  return JSON.stringify(message);
}

import type { Activity } from '../../shared/activity';
import type { Meeting } from '../../shared/meeting';
import type { ActivityAuthority } from './authority';
import { RoomError } from '../room-store';
type Commitment = Meeting['commitments'][number];
type Blocker = Meeting['blockers'][number];
const fail = (message: string): never => {
  throw new RoomError(message, 409);
};
export const grant = (roomId: string, activityId: string, c: Commitment) => [
  roomId,
  activityId,
  c.id,
  c.title,
  c.prompt,
  c.ownerId,
  c.blockedBy,
  c.authorizedBy,
  c.authorizedAt,
  c.authorizedDependencies,
];
export const resolution = (roomId: string, activityId: string, b: Blocker) => [
  roomId,
  activityId,
  b.id,
  b.title,
  b.ownerId,
  b.status,
  b.resolution,
];
export function signResolution(
  roomId: string,
  a: Activity,
  b: Blocker,
  actor: string,
  text: string,
  utteranceId: string | null,
  authority: ActivityAuthority,
) {
  if (b.ownerId !== actor) fail('Only the blocker owner can confirm its completion.');
  if (b.status === 'resolved') return;
  b.status = 'resolved';
  b.resolution = {
    actor,
    at: Date.now(),
    text,
    utteranceId,
    source: 'owner-statement',
  };
  b.proof = authority.sign(resolution(roomId, a.id, b));
}

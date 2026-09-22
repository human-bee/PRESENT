import type { Activity, Utterance } from '../../shared/activity';
import { ActivityAuthority } from './authority';
const authority = new ActivityAuthority();
const value = (room: string, a: Activity, u: Utterance) => [
  'utterance/v1',
  room,
  a.id,
  u.id,
  u.at,
  u.text,
  u.source,
  u.speakerId,
];
export function sealUtterance(room: string, a: Activity, u: Utterance) {
  u.captureProof = authority.sign(value(room, a, u));
}
export function trustedUtterance(room: string, a: Activity, u: Utterance) {
  return authority.verify(value(room, a, u), u.captureProof);
}

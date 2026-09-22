import type { Activity } from '../../shared/activity';
import type { fetchLinearProfile } from './linear';
type Access = { update: (room: string, id: string, update: (a: Activity) => void) => void };
export function enrichProfiles(
  roomId: string,
  a: Activity,
  access: Access,
  profile: typeof fetchLinearProfile,
  pending: Map<string, Promise<void>>,
  controllers: Set<AbortController>,
) {
  for (const member of a.meeting.members.filter((p) => p.status === 'pending' && p.linearId)) {
    const key = `${roomId}:${a.id}:profile:${member.actor}`;
    if (pending.has(key) || pending.size >= 8) continue;
    const controller = new AbortController();
    controllers.add(controller);
    const promise = profile(
      member.actor,
      member.linearId as string,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    )
      .then((profile) =>
        access.update(roomId, a.id, (next) => {
          const target = next.meeting.members.find((p) => p.actor === member.actor);
          if (target?.linearId === member.linearId && target.status === 'pending')
            Object.assign(target, profile, { personalStrengths: target.personalStrengths, about: target.about });
        }),
      )
      .catch((error) =>
        access.update(roomId, a.id, (next) => {
          const target = next.meeting.members.find((p) => p.actor === member.actor);
          if (target?.linearId === member.linearId && target.status === 'pending') {
            target.status = 'failed';
            target.error = String(error instanceof Error ? error.message : 'Profile lookup failed.').slice(0, 250);
          }
        }),
      )
      .finally(() => {
        pending.delete(key);
        controllers.delete(controller);
      });
    pending.set(key, promise);
    void promise.catch(() => {});
  }
}

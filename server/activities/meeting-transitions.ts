import { grant } from './meeting-authorization';
import { createHash } from 'node:crypto';
import type { Activity, ActivityCommand } from '../../shared/activity';
import type { Meeting } from '../../shared/meeting';
import { RoomError } from '../room-store';
import type { ActivityAuthority } from './authority';

type Blocker = Meeting['blockers'][number];
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const fail = (message: string): never => {
  throw new RoomError(message, 409);
};

export function reduceMeeting(
  roomId: string,
  a: Activity,
  command: ActivityCommand,
  actor: string,
  requestId: string,
  authority: ActivityAuthority,
  confirm: (room: string, a: Activity, b: Blocker, actor: string, text: string, utterance: string | null) => void,
): boolean {
  const m = a.meeting;
  if (command.type === 'profile-strengths') {
    const profile = m.members.find((p) => p.actor === actor) ?? fail('Introduce yourself first.');
    profile.personalStrengths = command.strengths;
    profile.about = command.about;
    return true;
  }
  if (command.type === 'resolution-review') {
    const suggestion =
      a.resolutionSuggestions.find((s) => s.id === command.suggestionId) ??
      fail('That suggestion is no longer available.');
    const blocker = m.blockers.find((b) => b.id === suggestion.blockerId) ?? fail('That blocker is missing.');
    if (blocker.ownerId !== actor) fail('Only the blocker owner can review this suggestion.');
    if (command.accept) confirm(roomId, a, blocker, actor, suggestion.source.quote, suggestion.source.utteranceId);
    suggestion.status = command.accept ? 'confirmed' : 'dismissed';
    suggestion.reason = 'Reviewed explicitly by the blocker owner.';
    return true;
  }
  if (command.type === 'profile') {
    let member = m.members.find((p) => p.actor === actor);
    if (!member) {
      if (m.members.length >= 24) fail('The member list is full.');
      member = {
        actor,
        avatarUrl: '',
        personalStrengths: command.profile.strengths,
        about: '',
        ...command.profile,
        source: 'self-described',
        fetchedAt: Date.now(),
        linearId: null,
        status: 'ready',
        error: null,
      };
      m.members.push(member);
    } else
      Object.assign(member, command.profile, {
        source: 'self-described',
        fetchedAt: Date.now(),
        status: 'ready',
        error: null,
      });
    return true;
  }
  if (command.type === 'profile-linear' || command.type === 'profile-self') {
    const previous = m.members.find((p) => p.actor === actor);
    if (!previous && m.members.length >= 24) fail('The member list is full.');
    const profile = {
      actor,
      avatarUrl: '',
      personalStrengths: previous?.personalStrengths ?? [],
      about: previous?.about ?? '',
      name: a.seats.find((s) => s.actor === actor)?.name ?? 'New teammate',
      team: '',
      projects: [],
      strengths: [],
      source: 'linear' as const,
      sourceUrl: '',
      fetchedAt: 0,
      linearId: command.type === 'profile-self' ? 'viewer' : command.userId,
      status: 'pending' as const,
      error: null,
    };
    if (previous) Object.assign(previous, profile);
    else m.members.push(profile);
    return true;
  }
  if (command.type === 'blocker') {
    if (!a.seats.some((s) => s.actor === command.ownerId)) fail('Choose a teammate in the room.');
    if (m.blockers.length >= 24) fail('The blocker board is full.');
    m.blockers.push({
      id: `blocker-${hash([actor, requestId])}`,
      title: command.title,
      ownerId: command.ownerId,
      status: 'open',
      resolution: null,
      proof: '',
    });
    return true;
  }
  if (command.type === 'focus-blocker' || command.type === 'resolve-blocker') {
    const b = m.blockers.find((b) => b.id === command.blockerId) ?? fail('That blocker is no longer available.');
    if (b.ownerId !== actor) fail('Only the blocker owner can discuss or resolve it.');
    if (command.type === 'focus-blocker') m.focus[actor] = b.id;
    else confirm(roomId, a, b, actor, command.text, null);
    return true;
  }
  if (command.type === 'commitment') {
    if (m.commitments.length >= 24) fail('The commitment board is full.');
    if (
      !a.seats.some((s) => s.actor === command.ownerId) ||
      command.blockedBy.some((id) => !m.blockers.some((b) => b.id === id))
    )
      fail('Choose existing teammates and blockers.');
    m.commitments.push({
      id: `commitment-${hash([actor, requestId])}`,
      title: command.title,
      prompt: command.prompt,
      ownerId: command.ownerId,
      blockedBy: [...new Set(command.blockedBy)],
      authorizedDependencies: [],
      authorizedBy: null,
      authorizedAt: null,
      authorization: '',
      status: 'blocked',
      jobId: null,
      objectId: null,
      error: null,
    });
    return true;
  }
  if (
    command.type === 'authorize-work' ||
    command.type === 'cancel-authorization' ||
    command.type === 'retry-dispatch'
  ) {
    const c =
      m.commitments.find((c) => c.id === command.commitmentId) ?? fail('That commitment is no longer available.');
    if (c.ownerId !== actor) fail('Only the human owner can authorize this work.');
    if (c.jobId || (c.status === 'dispatching' && command.type !== 'retry-dispatch'))
      fail('This work was dispatched. Use its work card to cancel or resume.');
    if (command.type === 'cancel-authorization') {
      c.authorizedBy = null;
      c.authorizedAt = null;
      c.authorization = '';
      c.status = 'blocked';
      return true;
    }
    if (command.type === 'retry-dispatch') {
      if (!c.authorization) fail('Authorize the work before dispatching.');
      c.status = 'blocked';
      c.error = null;
      return true;
    }
    c.authorizedDependencies = c.blockedBy.map((id) => {
      const b = m.blockers.find((b) => b.id === id) ?? fail('A required blocker is missing.');
      return { id: b.id, title: b.title, ownerId: b.ownerId };
    });
    c.authorizedBy = actor;
    c.authorizedAt = Date.now();
    c.authorization = authority.sign(grant(roomId, a.id, c));
    return true;
  }
  return false;
}

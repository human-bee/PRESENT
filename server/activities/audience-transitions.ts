import { createHash } from 'node:crypto';
import type { Activity, ActivityCommand } from '../../shared/activity';
import { retainAudience, type Audience } from '../../shared/audience';
import { RoomError } from '../room-store';
import type { ActivityAuthority } from './authority';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const fail = (message: string): never => {
  throw new RoomError(message, 409);
};
export const grant = (roomId: string, activityId: string, c: NonNullable<Audience['connection']>) => [
  roomId,
  activityId,
  c.liveChatId,
  c.sourceUrl,
  c.requestedBy,
];
export function reduceAudience(
  roomId: string,
  a: Activity,
  command: ActivityCommand,
  actor: string,
  requestId: string,
  authority: ActivityAuthority,
) {
  if (!command.type.startsWith('audience-')) return false;
  if (a.kind !== 'live') fail('Audience actions belong in a live room.');
  const audience = a.audience;
  if (command.type === 'audience-comment') {
    const sourceId = hash([actor, requestId]),
      authorId = `room:${actor}`;
    if (audience.blockedAuthors.includes(authorId)) fail('This participant is blocked from this audience queue.');
    if (!audience.comments.some((c) => c.sourceId === sourceId && c.source === 'room'))
      audience.comments.push({
        id: `comment-${sourceId}`,
        sourceId,
        source: 'room',
        sourceUrl: '',
        authorId,
        authorName: command.name,
        text: command.text,
        at: Date.now(),
        receivedAt: Date.now(),
        category: command.category,
        status: 'pending',
        votes: [],
        moderatedBy: null,
        moderationReason: '',
      });
    retainAudience(audience);
    return true;
  }
  if (command.type === 'audience-vote') {
    const comment =
      audience.comments.find((c) => c.id === command.commentId) ?? fail('This suggestion is no longer in the queue.');
    if (comment.status !== 'approved') fail('Only approved suggestions accept votes.');
    if (!comment.votes.includes(actor)) {
      if (comment.votes.length >= 100) fail('This suggestion has reached the room vote limit.');
      comment.votes.push(actor);
    }
    return true;
  }
  if (a.createdBy !== actor) fail('Only the live room host can moderate or connect its feed.');
  if (command.type === 'audience-moderate' || command.type === 'audience-block') {
    const comment =
      audience.comments.find((c) => c.id === command.commentId) ?? fail('This comment is no longer retained.');
    if (command.type === 'audience-block') {
      if (audience.blockedAuthors.length >= 100) fail('This room’s block list is full.');
      if (!audience.blockedAuthors.includes(comment.authorId)) audience.blockedAuthors.push(comment.authorId);
      for (const c of audience.comments.filter((c) => c.authorId === comment.authorId)) {
        c.status = 'rejected';
        c.moderatedBy = actor;
        c.moderationReason = 'Author blocked by host';
      }
    } else {
      if (command.status === 'live')
        for (const c of audience.comments.filter((c) => c.status === 'live')) {
          c.status = 'done';
          c.moderatedBy = actor;
          c.moderationReason = 'Host moved to the next item';
        }
      comment.status = command.status;
      comment.moderatedBy = actor;
      comment.moderationReason = command.reason;
    }
    return true;
  }
  if (command.type === 'audience-connect') {
    const connection: NonNullable<Audience['connection']> = {
      liveChatId: command.liveChatId,
      status: 'connecting',
      requestedBy: actor,
      sourceUrl: `https://www.youtube.com/watch?v=${command.videoId}`,
      cursor: audience.connection?.liveChatId === command.liveChatId ? audience.connection.cursor : '',
      nextAt: 0,
      lastAt: 0,
      error: null,
      proof: '',
    };
    connection.proof = authority.sign(grant(roomId, a.id, connection));
    audience.connection = connection;
    return true;
  }
  if (command.type === 'audience-stop') {
    if (audience.connection) audience.connection.status = 'off';
    return true;
  }
  return false;
}

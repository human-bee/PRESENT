import { z } from 'zod';
import { makeObject, objectSchema, type RoomObject } from './room';

export const mediaReferenceSchema = z.object({
  capability: z.enum(['participant', 'screen-share']),
  participantId: z.string().regex(/^[\w:.-]{1,100}$/),
  name: z.string().trim().min(1).max(80).refine(value => !/\p{Cc}/u.test(value)),
}).strict();
export type MediaReference = z.infer<typeof mediaReferenceSchema>;
export type MediaReferenceKind = MediaReference['capability'];

/** Only a stable identity and source selector cross the document boundary. */
export function readMediaReference(value: unknown): MediaReference | null {
  const parsed = mediaReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function makeMediaObject(participantId: string, name: string, kind: MediaReferenceKind, actor: string, position: { x: number; y: number }): RoomObject {
  const displayName = name.replace(/\p{Cc}/gu, '').trim().slice(0, 80) || 'Someone';
  const reference = mediaReferenceSchema.parse({ capability: kind, participantId, name: displayName });
  return objectSchema.parse({
    ...makeObject('widget', actor, position, reference),
    title: `${displayName}’s ${kind === 'participant' ? 'camera' : 'screen'}`,
    w: kind === 'participant' ? 480 : 640,
    h: kind === 'participant' ? 300 : 400,
  });
}

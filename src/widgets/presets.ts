import { makeObject, type RoomObject } from '../../shared/room';
import { diceHtml, pollHtml, synthHtml, teleprompterHtml } from './preset-markup';

export type StarterKind = 'note' | 'timer' | 'dice' | 'teleprompter' | 'poll' | 'synth';

/** Explicit quick-add objects. AI generation has its own separate path. */
export function createStarter(kind: StarterKind, actor: string, position: { x: number; y: number }): RoomObject {
  if (kind === 'note') return { ...makeObject('note', actor, position, { text: '' }), title: 'A thought', w: 330, h: 250 };
  if (kind === 'timer') return makeObject('timer', actor, position, { durationMs: 300_000, remainingMs: 300_000, endsAt: null });
  const definitions = {
    dice: { title: 'A little chance', html: diceHtml, state: { value: null, rolls: 0 }, w: 270, h: 300 },
    poll: { title: 'A room pulse', html: pollHtml, state: { question: 'Where do we go next?',  }, w: 350, h: 345 },
    teleprompter: { title: 'Find your words', html: teleprompterHtml, state: { text: 'Take a breath.\n\nLook at the people in the room.\n\nYou do not need to have it all figured out.\n\nStart with the thing you care about.\n\nThe rest will follow.', speed: 24, playing: false, offset: 0, startedAt: null }, w: 430, h: 420 },
    synth: { title: 'A shared frequency', html: synthHtml, state: { frequency: 220, waveform: 'sine' }, w: 360, h: 330 },
  };
  const { title, html, state, w, h } = definitions[kind];
  return { ...makeObject('widget', actor, position, { html, state }), title, w, h };
}

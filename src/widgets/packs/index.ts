import { CAPABILITIES, type CapabilityKind } from '../../../shared/capabilities';
import { makeObject, type RoomObject } from '../../../shared/room';
import { cardsHtml } from './cards';
import { debateHtml } from './debate';
import { diceHtml } from './dice';
import { documentHtml } from './document';
import { standardDeck } from './game-state';
import { kanbanHtml } from './kanban';
import { audienceHtml } from './audience';
import { briefHtml } from './brief';

const definitions = {
  document: { html: documentHtml, w: 720, h: 550, state: () => ({ markdown: '' }) },
  kanban: { html: kanbanHtml, w: 720, h: 520, state: () => ({}) },
  brief: { html: briefHtml, w: 640, h: 630, state: () => ({ summary: '' }) },
  audience: { html: audienceHtml, w: 520, h: 590, state: () => ({ activeQuestionId: null }) },
  captions: { html: '', w: 460, h: 340, state: () => ({}) },
  debate: { html: debateHtml, w: 560, h: 590, state: () => ({ 'score:affirmative': 0, 'score:negative': 0 }) },
  cards: { html: cardsHtml, w: 600, h: 410, state: standardDeck },
  dice: { html: diceHtml, w: 380, h: 400, state: () => ({}) },
};

export function createCapability(kind: CapabilityKind, actor: string, position: { x: number; y: number }): RoomObject {
  const { html, w, h, state } = definitions[kind];
  const title = CAPABILITIES.find((item) => item.kind === kind)?.title ?? kind;
  return { ...makeObject('widget', actor, position, { capability: kind, html, state: state() }), title, w, h };
}

import { z } from 'zod';

export const MAX_DIE_SIDES = 100;
export const DICE_ANIMATION_MS = 950;
export const CARD_ANIMATION_MS = 1100;
export const CARD_SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
export const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export type CardSuit = (typeof CARD_SUITS)[number];
export type CardRank = (typeof CARD_RANKS)[number];

export type DiceRuntimeState = {
  diceCount: number;
  dieOneSides: number;
  dieTwoSides: number;
  values: number[];
  total: number;
  rollId: string | null;
  startedAt: number | null;
  resolvedAt: number | null;
  updatedAt: number;
  animationSeed: number | null;
};

export type DrawnCard = {
  id: string;
  rank: CardRank;
  rankValue: number;
  suit: CardSuit;
};

export type CardRuntimeState = {
  drawCount: number;
  rankMin: number;
  rankMax: number;
  allowedSuits: CardSuit[];
  cards: DrawnCard[];
  flipId: string | null;
  startedAt: number | null;
  resolvedAt: number | null;
  updatedAt: number;
  animationSeed: number | null;
  validationMessage: string | null;
};

export const diceWidgetSchema = z.object({
  title: z.string().optional().describe('Optional widget title'),
  diceCount: z.number().int().min(1).max(2).default(2).describe('Whether to roll one or two dice'),
  dieOneSides: z.number().int().min(2).max(MAX_DIE_SIDES).default(6).describe('Number of sides on the first die'),
  dieTwoSides: z.number().int().min(2).max(MAX_DIE_SIDES).default(6).describe('Number of sides on the second die'),
  roll: z.boolean().optional().describe('Trigger a new roll when true'),
});

export const cardWidgetSchema = z.object({
  title: z.string().optional().describe('Optional widget title'),
  drawCount: z.number().int().min(1).max(5).default(3).describe('How many cards to flip at once'),
  rankMin: z.number().int().min(1).max(13).default(1).describe('Lowest allowed rank, where 1 is Ace and 13 is King'),
  rankMax: z.number().int().min(1).max(13).default(13).describe('Highest allowed rank, where 1 is Ace and 13 is King'),
  allowedSuits: z.array(z.enum(CARD_SUITS)).min(1).default([...CARD_SUITS]).describe('Suits allowed in the draw'),
  flip: z.boolean().optional().describe('Trigger a new card flip when true'),
});

type RollDiceArgs = {
  diceCount: number;
  dieOneSides: number;
  dieTwoSides: number;
  timestamp: number;
  random?: () => number;
};

type FlipCardsArgs = {
  drawCount: number;
  rankMin: number;
  rankMax: number;
  allowedSuits: CardSuit[];
  timestamp: number;
  random?: () => number;
};

type DeterministicSeedInput = {
  actionId: string;
  timestamp: number;
  version?: number | null;
  config: Record<string, unknown>;
};

const DEFAULT_DICE_STATE: DiceRuntimeState = {
  diceCount: 2,
  dieOneSides: 6,
  dieTwoSides: 6,
  values: [1, 1],
  total: 2,
  rollId: null,
  startedAt: null,
  resolvedAt: null,
  updatedAt: 0,
  animationSeed: null,
};

const DEFAULT_CARD_STATE: CardRuntimeState = {
  drawCount: 3,
  rankMin: 1,
  rankMax: 13,
  allowedSuits: [...CARD_SUITS],
  cards: [],
  flipId: null,
  startedAt: null,
  resolvedAt: null,
  updatedAt: 0,
  animationSeed: null,
  validationMessage: null,
};

const normalizeInteger = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return undefined;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const nextActionId = (prefix: string, timestamp: number, random: () => number = Math.random) =>
  `${prefix}-${timestamp.toString(36)}-${Math.floor(random() * 0xffffff).toString(36).padStart(5, '0')}`;

export const cardLabel = (card: DrawnCard) => `${card.rank}${card.suit[0].toUpperCase()}`;

export const suitSymbol = (suit: CardSuit) => {
  switch (suit) {
    case 'spades':
      return '♠';
    case 'hearts':
      return '♥';
    case 'clubs':
      return '♣';
    case 'diamonds':
      return '♦';
  }
};

export const suitTone = (suit: CardSuit) =>
  suit === 'hearts' || suit === 'diamonds' ? 'text-[var(--present-danger)]' : 'text-slate-900';

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const createSeededRandom = (seedValue: string) => {
  let seed = hashString(seedValue) || 1;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

export const deriveDeterministicSeed = ({
  actionId,
  timestamp,
  version,
  config,
}: DeterministicSeedInput) =>
  stableStringify({
    actionId,
    timestamp,
    version: version ?? null,
    config,
  });

export function parseDiceRuntimeState(raw: unknown): DiceRuntimeState {
  const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const diceCount = clamp(normalizeInteger(state.diceCount) ?? DEFAULT_DICE_STATE.diceCount, 1, 2);
  const dieOneSides = clamp(normalizeInteger(state.dieOneSides) ?? DEFAULT_DICE_STATE.dieOneSides, 2, MAX_DIE_SIDES);
  const dieTwoSides = clamp(normalizeInteger(state.dieTwoSides) ?? DEFAULT_DICE_STATE.dieTwoSides, 2, MAX_DIE_SIDES);
  const rawValues = Array.isArray(state.values)
    ? state.values.map((value, index) =>
        clamp(normalizeInteger(value) ?? 1, 1, index === 0 ? dieOneSides : dieTwoSides),
      )
    : DEFAULT_DICE_STATE.values;
  const values = rawValues.slice(0, diceCount);
  while (values.length < diceCount) {
    values.push(1);
  }
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    diceCount,
    dieOneSides,
    dieTwoSides,
    values,
    total,
    rollId: typeof state.rollId === 'string' ? state.rollId : null,
    startedAt: normalizeInteger(state.startedAt) ?? null,
    resolvedAt: normalizeInteger(state.resolvedAt) ?? null,
    updatedAt: normalizeInteger(state.updatedAt) ?? 0,
    animationSeed: normalizeInteger(state.animationSeed) ?? null,
  };
}

export function parseCardRuntimeState(raw: unknown): CardRuntimeState {
  const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const drawCount = clamp(normalizeInteger(state.drawCount) ?? DEFAULT_CARD_STATE.drawCount, 1, 5);
  const rankMin = clamp(normalizeInteger(state.rankMin) ?? DEFAULT_CARD_STATE.rankMin, 1, 13);
  const rankMaxCandidate = clamp(normalizeInteger(state.rankMax) ?? DEFAULT_CARD_STATE.rankMax, 1, 13);
  const rankMax = Math.max(rankMin, rankMaxCandidate);
  const allowedSuits = normalizeAllowedSuits(state.allowedSuits);
  const cards = Array.isArray(state.cards)
    ? state.cards
        .map((card) => normalizeCard(card))
        .filter((card): card is DrawnCard => card !== null)
        .slice(0, drawCount)
    : [];

  return {
    drawCount,
    rankMin,
    rankMax,
    allowedSuits,
    cards,
    flipId: typeof state.flipId === 'string' ? state.flipId : null,
    startedAt: normalizeInteger(state.startedAt) ?? null,
    resolvedAt: normalizeInteger(state.resolvedAt) ?? null,
    updatedAt: normalizeInteger(state.updatedAt) ?? 0,
    animationSeed: normalizeInteger(state.animationSeed) ?? null,
    validationMessage:
      typeof state.validationMessage === 'string' && state.validationMessage.trim()
        ? state.validationMessage
        : null,
  };
}

function normalizeCard(raw: unknown): DrawnCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const card = raw as Record<string, unknown>;
  const rankValue = clamp(normalizeInteger(card.rankValue) ?? 1, 1, 13);
  const rank = CARD_RANKS[rankValue - 1];
  const suit = typeof card.suit === 'string' && (CARD_SUITS as readonly string[]).includes(card.suit)
    ? (card.suit as CardSuit)
    : null;
  if (!suit) return null;
  return {
    id: typeof card.id === 'string' ? card.id : `${rank}-${suit}`,
    rank,
    rankValue,
    suit,
  };
}

function normalizeAllowedSuits(raw: unknown): CardSuit[] {
  const incoming = Array.isArray(raw) ? raw : [];
  const suits = incoming.filter((suit): suit is CardSuit =>
    typeof suit === 'string' && (CARD_SUITS as readonly string[]).includes(suit),
  );
  return suits.length > 0 ? Array.from(new Set(suits)) : [...CARD_SUITS];
}

export function reduceDiceRuntimeState(
  prev: DiceRuntimeState,
  patch: Record<string, unknown>,
  timestamp: number,
  random: () => number = Math.random,
): DiceRuntimeState {
  const diceCount = clamp(normalizeInteger(patch.diceCount) ?? prev.diceCount, 1, 2);
  const dieOneSides = clamp(normalizeInteger(patch.dieOneSides) ?? prev.dieOneSides, 2, MAX_DIE_SIDES);
  const dieTwoSides = clamp(normalizeInteger(patch.dieTwoSides) ?? prev.dieTwoSides, 2, MAX_DIE_SIDES);

  const explicitValues = Array.isArray(patch.values)
    ? patch.values
        .map((value, index) => {
          const limit = index === 0 ? dieOneSides : dieTwoSides;
          return clamp(normalizeInteger(value) ?? 1, 1, limit);
        })
        .slice(0, diceCount)
    : null;

  if (explicitValues) {
    const total = explicitValues.reduce((sum, value) => sum + value, 0);
    return {
      diceCount,
      dieOneSides,
      dieTwoSides,
      values: explicitValues,
      total,
      rollId: typeof patch.rollId === 'string' ? patch.rollId : prev.rollId,
      startedAt: normalizeInteger(patch.startedAt) ?? prev.startedAt,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? prev.resolvedAt,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed: normalizeInteger(patch.animationSeed) ?? prev.animationSeed,
    };
  }

  const shouldRoll = patch.roll === true || typeof patch.rollId === 'string';
  if (shouldRoll) {
    const { values, total, animationSeed } = rollDice({
      diceCount,
      dieOneSides,
      dieTwoSides,
      timestamp,
      random,
    });
    return {
      diceCount,
      dieOneSides,
      dieTwoSides,
      values,
      total,
      rollId: typeof patch.rollId === 'string' ? patch.rollId : nextActionId('roll', timestamp, random),
      startedAt: normalizeInteger(patch.startedAt) ?? timestamp,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? timestamp,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed,
    };
  }

  const nextValues = prev.values.slice(0, diceCount);
  while (nextValues.length < diceCount) {
    nextValues.push(1);
  }
  const total = nextValues.reduce((sum, value) => sum + value, 0);

  return {
    ...prev,
    diceCount,
    dieOneSides,
    dieTwoSides,
    values: nextValues,
    total,
    updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
  };
}

export function reduceCardRuntimeState(
  prev: CardRuntimeState,
  patch: Record<string, unknown>,
  timestamp: number,
  random: () => number = Math.random,
): CardRuntimeState {
  const drawCount = clamp(normalizeInteger(patch.drawCount) ?? prev.drawCount, 1, 5);
  const rankMin = clamp(normalizeInteger(patch.rankMin) ?? prev.rankMin, 1, 13);
  const rankMax = Math.max(rankMin, clamp(normalizeInteger(patch.rankMax) ?? prev.rankMax, 1, 13));
  const allowedSuits = Object.prototype.hasOwnProperty.call(patch, 'allowedSuits')
    ? normalizeAllowedSuits(patch.allowedSuits)
    : prev.allowedSuits;

  const explicitCards = Array.isArray(patch.cards)
    ? patch.cards
        .map((card) => normalizeCard(card))
        .filter((card): card is DrawnCard => card !== null)
        .slice(0, drawCount)
    : null;

  if (explicitCards) {
    return {
      drawCount,
      rankMin,
      rankMax,
      allowedSuits,
      cards: explicitCards,
      flipId: typeof patch.flipId === 'string' ? patch.flipId : prev.flipId,
      startedAt: normalizeInteger(patch.startedAt) ?? prev.startedAt,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? prev.resolvedAt,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed: normalizeInteger(patch.animationSeed) ?? prev.animationSeed,
      validationMessage:
        typeof patch.validationMessage === 'string' ? patch.validationMessage : prev.validationMessage,
    };
  }

  const shouldFlip = patch.flip === true || typeof patch.flipId === 'string';
  if (shouldFlip) {
    const flip = flipCards({
      drawCount,
      rankMin,
      rankMax,
      allowedSuits,
      timestamp,
      random,
    });
    return {
      drawCount,
      rankMin,
      rankMax,
      allowedSuits,
      cards: flip.cards,
      flipId: typeof patch.flipId === 'string' ? patch.flipId : nextActionId('flip', timestamp, random),
      startedAt: normalizeInteger(patch.startedAt) ?? timestamp,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? timestamp,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed: flip.animationSeed,
      validationMessage: flip.validationMessage,
    };
  }

  return {
    ...prev,
    drawCount,
    rankMin,
    rankMax,
    allowedSuits,
    cards: prev.cards.slice(0, drawCount),
    updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
    validationMessage:
      typeof patch.validationMessage === 'string' ? patch.validationMessage : prev.validationMessage,
  };
}

export function rollDice({
  diceCount,
  dieOneSides,
  dieTwoSides,
  timestamp,
  random = Math.random,
}: RollDiceArgs) {
  const sides = [dieOneSides, dieTwoSides].slice(0, clamp(diceCount, 1, 2));
  const values = sides.map((sideCount) => clamp(Math.floor(random() * sideCount) + 1, 1, sideCount));
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    values,
    total,
    animationSeed: Math.floor(random() * 10_000) + timestamp % 1_000,
  };
}

export function resolveDiceAgentPatch(
  patch: Record<string, unknown>,
  prev: DiceRuntimeState,
): Record<string, unknown> {
  if (Array.isArray(patch.values)) {
    return patch;
  }
  if (!(patch.roll === true || typeof patch.rollId === 'string')) {
    return patch;
  }

  const timestamp = normalizeInteger(patch.updatedAt) ?? normalizeInteger(patch.startedAt) ?? Date.now();
  const diceCount = clamp(normalizeInteger(patch.diceCount) ?? prev.diceCount, 1, 2);
  const dieOneSides = clamp(normalizeInteger(patch.dieOneSides) ?? prev.dieOneSides, 2, MAX_DIE_SIDES);
  const dieTwoSides = clamp(normalizeInteger(patch.dieTwoSides) ?? prev.dieTwoSides, 2, MAX_DIE_SIDES);
  const rollId = typeof patch.rollId === 'string' ? patch.rollId : `agent-roll-v${normalizeInteger(patch.version) ?? prev.updatedAt}-${diceCount}-${dieOneSides}-${dieTwoSides}`;
  const random = createSeededRandom(
    deriveDeterministicSeed({
      actionId: rollId,
      timestamp,
      version: normalizeInteger(patch.version) ?? null,
      config: { diceCount, dieOneSides, dieTwoSides },
    }),
  );
  const result = rollDice({ diceCount, dieOneSides, dieTwoSides, timestamp, random });
  return {
    ...patch,
    diceCount,
    dieOneSides,
    dieTwoSides,
    rollId,
    startedAt: normalizeInteger(patch.startedAt) ?? timestamp,
    resolvedAt: normalizeInteger(patch.resolvedAt) ?? timestamp,
    updatedAt: timestamp,
    values: result.values,
    total: result.total,
    animationSeed: result.animationSeed,
  };
}

export function buildAllowedCardPool(rankMin: number, rankMax: number, allowedSuits: CardSuit[]) {
  const min = clamp(rankMin, 1, 13);
  const max = Math.max(min, clamp(rankMax, 1, 13));
  const suits = normalizeAllowedSuits(allowedSuits);
  const pool: DrawnCard[] = [];
  for (let rankValue = min; rankValue <= max; rankValue += 1) {
    for (const suit of suits) {
      pool.push({
        id: `${rankValue}-${suit}`,
        rank: CARD_RANKS[rankValue - 1],
        rankValue,
        suit,
      });
    }
  }
  return pool;
}

export function flipCards({
  drawCount,
  rankMin,
  rankMax,
  allowedSuits,
  timestamp,
  random = Math.random,
}: FlipCardsArgs) {
  const pool = buildAllowedCardPool(rankMin, rankMax, allowedSuits);
  const desiredCount = clamp(drawCount, 1, 5);
  const actualCount = Math.min(desiredCount, pool.length);
  const deck = [...pool];
  const cards: DrawnCard[] = [];

  for (let index = 0; index < actualCount; index += 1) {
    const pickIndex = Math.floor(random() * deck.length);
    const [card] = deck.splice(pickIndex, 1);
    if (card) cards.push(card);
  }

  return {
    cards,
    animationSeed: Math.floor(random() * 10_000) + timestamp % 1_000,
    validationMessage:
      actualCount < desiredCount
        ? `Only ${actualCount} card${actualCount === 1 ? '' : 's'} available in this range.`
        : null,
  };
}

export function resolveCardAgentPatch(
  patch: Record<string, unknown>,
  prev: CardRuntimeState,
): Record<string, unknown> {
  if (Array.isArray(patch.cards)) {
    return patch;
  }
  if (!(patch.flip === true || typeof patch.flipId === 'string')) {
    return patch;
  }

  const timestamp = normalizeInteger(patch.updatedAt) ?? normalizeInteger(patch.startedAt) ?? Date.now();
  const drawCount = clamp(normalizeInteger(patch.drawCount) ?? prev.drawCount, 1, 5);
  const rankMin = clamp(normalizeInteger(patch.rankMin) ?? prev.rankMin, 1, 13);
  const rankMax = Math.max(rankMin, clamp(normalizeInteger(patch.rankMax) ?? prev.rankMax, 1, 13));
  const allowedSuits = Object.prototype.hasOwnProperty.call(patch, 'allowedSuits')
    ? normalizeAllowedSuits(patch.allowedSuits)
    : prev.allowedSuits;
  const flipId =
    typeof patch.flipId === 'string'
      ? patch.flipId
      : `agent-flip-v${normalizeInteger(patch.version) ?? prev.updatedAt}-${drawCount}-${rankMin}-${rankMax}-${allowedSuits.join('-')}`;
  const random = createSeededRandom(
    deriveDeterministicSeed({
      actionId: flipId,
      timestamp,
      version: normalizeInteger(patch.version) ?? null,
      config: { drawCount, rankMin, rankMax, allowedSuits },
    }),
  );
  const result = flipCards({ drawCount, rankMin, rankMax, allowedSuits, timestamp, random });
  return {
    ...patch,
    drawCount,
    rankMin,
    rankMax,
    allowedSuits,
    flipId,
    startedAt: normalizeInteger(patch.startedAt) ?? timestamp,
    resolvedAt: normalizeInteger(patch.resolvedAt) ?? timestamp,
    updatedAt: timestamp,
    cards: result.cards,
    animationSeed: result.animationSeed,
    validationMessage: result.validationMessage,
  };
}

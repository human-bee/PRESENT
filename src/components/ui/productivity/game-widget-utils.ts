import { z } from 'zod';

export const MAX_DIE_SIDES = 100;
export const MAX_DICE_COUNT = 6;
export const MAX_CARD_DRAW_COUNT = 6;
export const DICE_ANIMATION_MS = 1250;
export const CARD_ANIMATION_MS = 1200;
export const CARD_SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
export const CARD_RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const;
export const DICE_LAYOUTS = ['spread', 'versus'] as const;
export const CARD_LAYOUTS = ['fan', 'versus'] as const;
export const CARD_SUIT_MODES = ['all', 'custom', 'none'] as const;
export const CARD_RANK_STYLES = ['classic', 'numeric'] as const;

export type CardSuit = (typeof CARD_SUITS)[number];
export type CardRank = (typeof CARD_RANKS)[number];
export type DiceLayoutMode = (typeof DICE_LAYOUTS)[number];
export type CardLayoutMode = (typeof CARD_LAYOUTS)[number];
export type CardSuitMode = (typeof CARD_SUIT_MODES)[number];
export type CardRankStyle = (typeof CARD_RANK_STYLES)[number];

export type DiceRuntimeState = {
  diceCount: number;
  diceSides: number[];
  layoutMode: DiceLayoutMode;
  values: number[];
  total: number;
  groupTotals: number[];
  rollId: string | null;
  startedAt: number | null;
  resolvedAt: number | null;
  updatedAt: number;
  animationSeed: number | null;
};

export type DrawnCard = {
  id: string;
  rankValue: number;
  suit: CardSuit | null;
};

export type CardRuntimeState = {
  drawCount: number;
  layoutMode: CardLayoutMode;
  rankMin: number;
  rankMax: number;
  rankStyle: CardRankStyle;
  suitMode: CardSuitMode;
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
  diceCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_DICE_COUNT)
    .default(2)
    .describe('How many dice to roll, from one to six'),
  diceSides: z
    .array(z.number().int().min(2).max(MAX_DIE_SIDES))
    .max(MAX_DICE_COUNT)
    .optional()
    .describe('Per-die sides; missing entries inherit the previous die side count'),
  dieOneSides: z
    .number()
    .int()
    .min(2)
    .max(MAX_DIE_SIDES)
    .default(6)
    .describe('Legacy first-die side count'),
  dieTwoSides: z
    .number()
    .int()
    .min(2)
    .max(MAX_DIE_SIDES)
    .default(6)
    .describe('Legacy second-die side count'),
  layoutMode: z
    .enum(DICE_LAYOUTS)
    .default('spread')
    .describe('Show dice in one pool or split them into versus groups'),
  roll: z.boolean().optional().describe('Trigger a new roll when true'),
});

export const cardWidgetSchema = z.object({
  title: z.string().optional().describe('Optional widget title'),
  drawCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_CARD_DRAW_COUNT)
    .default(3)
    .describe('How many cards to flip at once'),
  layoutMode: z
    .enum(CARD_LAYOUTS)
    .default('fan')
    .describe('Show one spread or split into versus hands'),
  rankMin: z
    .number()
    .int()
    .min(1)
    .max(13)
    .default(1)
    .describe('Lowest allowed rank, where 1 is Ace'),
  rankMax: z
    .number()
    .int()
    .min(1)
    .max(13)
    .default(13)
    .describe('Highest allowed rank, where 13 is King'),
  rankStyle: z
    .enum(CARD_RANK_STYLES)
    .default('classic')
    .describe('Use face-card labels or numeric labels'),
  suitMode: z
    .enum(CARD_SUIT_MODES)
    .default('all')
    .describe('Use all suits, a custom suit subset, or no suits at all'),
  allowedSuits: z
    .array(z.enum(CARD_SUITS))
    .default([...CARD_SUITS])
    .describe('Suit subset when suitMode is custom'),
  flip: z.boolean().optional().describe('Trigger a new card flip when true'),
});

type RollDiceArgs = {
  diceCount: number;
  diceSides: number[];
  layoutMode: DiceLayoutMode;
  timestamp: number;
  random?: () => number;
};

type FlipCardsArgs = {
  drawCount: number;
  layoutMode: CardLayoutMode;
  rankMin: number;
  rankMax: number;
  suitMode: CardSuitMode;
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
  diceSides: [6, 6],
  layoutMode: 'spread',
  values: [1, 1],
  total: 2,
  groupTotals: [2],
  rollId: null,
  startedAt: null,
  resolvedAt: null,
  updatedAt: 0,
  animationSeed: null,
};

const DEFAULT_CARD_STATE: CardRuntimeState = {
  drawCount: 3,
  layoutMode: 'fan',
  rankMin: 1,
  rankMax: 13,
  rankStyle: 'classic',
  suitMode: 'all',
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
  `${prefix}-${timestamp.toString(36)}-${Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(5, '0')}`;

const uniqueSuits = (raw: unknown) => {
  const incoming = Array.isArray(raw) ? raw : [];
  return incoming.filter((suit, index): suit is CardSuit => {
    return (
      typeof suit === 'string' &&
      (CARD_SUITS as readonly string[]).includes(suit) &&
      incoming.indexOf(suit) === index
    );
  });
};

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

export const suitSymbol = (suit: CardSuit | null) => {
  switch (suit) {
    case 'spades':
      return '♠';
    case 'hearts':
      return '♥';
    case 'clubs':
      return '♣';
    case 'diamonds':
      return '♦';
    default:
      return '';
  }
};

export const suitTone = (suit: CardSuit | null) =>
  suit === 'hearts' || suit === 'diamonds' ? 'text-[var(--present-danger)]' : 'text-slate-900';

export const rankLabel = (value: number, style: CardRankStyle = 'classic') => {
  if (style === 'numeric') return String(value);
  if (value === 1) return 'Ace';
  if (value === 11) return 'Jack';
  if (value === 12) return 'Queen';
  if (value === 13) return 'King';
  return String(value);
};

export const shortRankLabel = (value: number, style: CardRankStyle = 'classic') => {
  if (style === 'numeric') return String(value);
  return CARD_RANKS[value - 1] ?? String(value);
};

export const cardLabel = (card: DrawnCard, style: CardRankStyle = 'classic') => {
  const label = shortRankLabel(card.rankValue, style);
  return card.suit ? `${label}${suitSymbol(card.suit)}` : label;
};

export const describeSuitMode = (mode: CardSuitMode, allowedSuits: CardSuit[]) => {
  if (mode === 'none') return 'No suits';
  if (mode === 'all') return 'All suits';
  return `${allowedSuits.length} suit${allowedSuits.length === 1 ? '' : 's'}`;
};

const normalizeDiceLayoutMode = (value: unknown): DiceLayoutMode =>
  value === 'versus' ? 'versus' : 'spread';

const normalizeCardLayoutMode = (value: unknown): CardLayoutMode =>
  value === 'versus' ? 'versus' : 'fan';

const normalizeRankStyle = (value: unknown): CardRankStyle =>
  value === 'numeric' ? 'numeric' : 'classic';

const inferSuitMode = (rawMode: unknown, rawSuits: unknown): CardSuitMode => {
  if (rawMode === 'none' || rawMode === 'custom' || rawMode === 'all') {
    return rawMode;
  }
  const suits = uniqueSuits(rawSuits);
  if (suits.length === 0) return 'none';
  if (suits.length === CARD_SUITS.length) return 'all';
  return 'custom';
};

const normalizeAllowedSuitsForMode = (mode: CardSuitMode, raw: unknown) => {
  const suits = uniqueSuits(raw);
  if (mode === 'none') return [] as CardSuit[];
  if (mode === 'all') return [...CARD_SUITS];
  return suits.length > 0 ? suits : [...CARD_SUITS];
};

const normalizeDiceSides = (
  raw: unknown,
  diceCount: number,
  legacyOne?: unknown,
  legacyTwo?: unknown,
  fallback?: number[],
) => {
  const baseFallback = fallback && fallback.length > 0 ? fallback : DEFAULT_DICE_STATE.diceSides;
  const incoming = Array.isArray(raw) ? raw : [];
  const normalized: number[] = [];

  for (let index = 0; index < diceCount; index += 1) {
    const legacyValue = index === 0 ? legacyOne : index === 1 ? legacyTwo : undefined;
    const explicit = normalizeInteger(incoming[index]) ?? normalizeInteger(legacyValue);
    const inherited = normalized[index - 1] ?? baseFallback[index] ?? baseFallback.at(-1) ?? 6;
    normalized.push(clamp(explicit ?? inherited, 2, MAX_DIE_SIDES));
  }

  return normalized;
};

const getVersusGroups = <T>(items: T[]) => {
  const splitIndex = Math.ceil(items.length / 2);
  return [items.slice(0, splitIndex), items.slice(splitIndex)];
};

const computeDiceTotals = (values: number[], layoutMode: DiceLayoutMode) => {
  if (layoutMode !== 'versus') {
    return [values.reduce((sum, value) => sum + value, 0)];
  }
  return getVersusGroups(values).map((group) => group.reduce((sum, value) => sum + value, 0));
};

export function parseDiceRuntimeState(raw: unknown): DiceRuntimeState {
  const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const diceCount = clamp(
    normalizeInteger(state.diceCount) ?? DEFAULT_DICE_STATE.diceCount,
    1,
    MAX_DICE_COUNT,
  );
  const diceSides = normalizeDiceSides(
    state.diceSides,
    diceCount,
    state.dieOneSides,
    state.dieTwoSides,
    DEFAULT_DICE_STATE.diceSides,
  );

  const rawValues = Array.isArray(state.values)
    ? state.values.map((value, index) =>
        clamp(normalizeInteger(value) ?? 1, 1, diceSides[index] ?? 6),
      )
    : DEFAULT_DICE_STATE.values;
  const values = rawValues.slice(0, diceCount);
  while (values.length < diceCount) {
    values.push(1);
  }
  const layoutMode = normalizeDiceLayoutMode(state.layoutMode);
  const groupTotals = computeDiceTotals(values, layoutMode);

  return {
    diceCount,
    diceSides,
    layoutMode,
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    groupTotals,
    rollId: typeof state.rollId === 'string' ? state.rollId : null,
    startedAt: normalizeInteger(state.startedAt) ?? null,
    resolvedAt: normalizeInteger(state.resolvedAt) ?? null,
    updatedAt: normalizeInteger(state.updatedAt) ?? 0,
    animationSeed: normalizeInteger(state.animationSeed) ?? null,
  };
}

function normalizeCard(raw: unknown): DrawnCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const card = raw as Record<string, unknown>;
  const rankValue = clamp(normalizeInteger(card.rankValue) ?? 1, 1, 13);
  const suit =
    card.suit === null
      ? null
      : typeof card.suit === 'string' && (CARD_SUITS as readonly string[]).includes(card.suit)
        ? (card.suit as CardSuit)
        : null;
  return {
    id: typeof card.id === 'string' ? card.id : `${rankValue}-${suit ?? 'plain'}`,
    rankValue,
    suit,
  };
}

export function parseCardRuntimeState(raw: unknown): CardRuntimeState {
  const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const drawCount = clamp(
    normalizeInteger(state.drawCount) ?? DEFAULT_CARD_STATE.drawCount,
    1,
    MAX_CARD_DRAW_COUNT,
  );
  const rankMin = clamp(normalizeInteger(state.rankMin) ?? DEFAULT_CARD_STATE.rankMin, 1, 13);
  const rankMaxCandidate = clamp(
    normalizeInteger(state.rankMax) ?? DEFAULT_CARD_STATE.rankMax,
    1,
    13,
  );
  const rankMax = Math.max(rankMin, rankMaxCandidate);
  const suitMode = inferSuitMode(state.suitMode, state.allowedSuits);
  const allowedSuits = normalizeAllowedSuitsForMode(suitMode, state.allowedSuits);
  const cards = Array.isArray(state.cards)
    ? state.cards
        .map((card) => normalizeCard(card))
        .filter((card): card is DrawnCard => card !== null)
        .slice(0, drawCount)
    : [];

  return {
    drawCount,
    layoutMode: normalizeCardLayoutMode(state.layoutMode),
    rankMin,
    rankMax,
    rankStyle: normalizeRankStyle(state.rankStyle),
    suitMode,
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

export function reduceDiceRuntimeState(
  prev: DiceRuntimeState,
  patch: Record<string, unknown>,
  timestamp: number,
  random: () => number = Math.random,
): DiceRuntimeState {
  const diceCount = clamp(normalizeInteger(patch.diceCount) ?? prev.diceCount, 1, MAX_DICE_COUNT);
  const layoutMode = normalizeDiceLayoutMode(patch.layoutMode ?? prev.layoutMode);
  const diceSides = normalizeDiceSides(
    patch.diceSides,
    diceCount,
    patch.dieOneSides,
    patch.dieTwoSides,
    prev.diceSides,
  );

  const explicitValues = Array.isArray(patch.values)
    ? patch.values
        .map((value, index) => clamp(normalizeInteger(value) ?? 1, 1, diceSides[index] ?? 6))
        .slice(0, diceCount)
    : null;

  if (explicitValues) {
    const total = explicitValues.reduce((sum, value) => sum + value, 0);
    return {
      diceCount,
      diceSides,
      layoutMode,
      values: explicitValues,
      total,
      groupTotals: computeDiceTotals(explicitValues, layoutMode),
      rollId: typeof patch.rollId === 'string' ? patch.rollId : prev.rollId,
      startedAt: normalizeInteger(patch.startedAt) ?? prev.startedAt,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? prev.resolvedAt,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed: normalizeInteger(patch.animationSeed) ?? prev.animationSeed,
    };
  }

  const shouldRoll = patch.roll === true || typeof patch.rollId === 'string';
  if (shouldRoll) {
    const { values, total, groupTotals, animationSeed } = rollDice({
      diceCount,
      diceSides,
      layoutMode,
      timestamp,
      random,
    });
    return {
      diceCount,
      diceSides,
      layoutMode,
      values,
      total,
      groupTotals,
      rollId:
        typeof patch.rollId === 'string' ? patch.rollId : nextActionId('roll', timestamp, random),
      startedAt: normalizeInteger(patch.startedAt) ?? timestamp,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? timestamp,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed,
    };
  }

  const values = prev.values.slice(0, diceCount);
  while (values.length < diceCount) {
    values.push(1);
  }
  return {
    ...prev,
    diceCount,
    diceSides,
    layoutMode,
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    groupTotals: computeDiceTotals(values, layoutMode),
    updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
  };
}

export function buildAllowedCardPool(
  rankMin: number,
  rankMax: number,
  allowedSuits: CardSuit[],
  suitMode: CardSuitMode = 'all',
) {
  const min = clamp(rankMin, 1, 13);
  const max = Math.max(min, clamp(rankMax, 1, 13));
  const normalizedMode = suitMode === 'none' ? 'none' : suitMode;
  const suits = normalizeAllowedSuitsForMode(normalizedMode, allowedSuits);
  const pool: DrawnCard[] = [];

  for (let rankValue = min; rankValue <= max; rankValue += 1) {
    if (normalizedMode === 'none' || suits.length === 0) {
      pool.push({
        id: `${rankValue}-plain`,
        rankValue,
        suit: null,
      });
      continue;
    }

    for (const suit of suits) {
      pool.push({
        id: `${rankValue}-${suit}`,
        rankValue,
        suit,
      });
    }
  }
  return pool;
}

export function reduceCardRuntimeState(
  prev: CardRuntimeState,
  patch: Record<string, unknown>,
  timestamp: number,
  random: () => number = Math.random,
): CardRuntimeState {
  const drawCount = clamp(
    normalizeInteger(patch.drawCount) ?? prev.drawCount,
    1,
    MAX_CARD_DRAW_COUNT,
  );
  const rankMin = clamp(normalizeInteger(patch.rankMin) ?? prev.rankMin, 1, 13);
  const rankMax = Math.max(rankMin, clamp(normalizeInteger(patch.rankMax) ?? prev.rankMax, 1, 13));
  const suitMode = inferSuitMode(
    patch.suitMode ?? prev.suitMode,
    patch.allowedSuits ?? prev.allowedSuits,
  );
  const allowedSuits = normalizeAllowedSuitsForMode(
    suitMode,
    Object.prototype.hasOwnProperty.call(patch, 'allowedSuits')
      ? patch.allowedSuits
      : prev.allowedSuits,
  );
  const layoutMode = normalizeCardLayoutMode(patch.layoutMode ?? prev.layoutMode);
  const rankStyle = normalizeRankStyle(patch.rankStyle ?? prev.rankStyle);

  const explicitCards = Array.isArray(patch.cards)
    ? patch.cards
        .map((card) => normalizeCard(card))
        .filter((card): card is DrawnCard => card !== null)
        .slice(0, drawCount)
    : null;

  if (explicitCards) {
    return {
      drawCount,
      layoutMode,
      rankMin,
      rankMax,
      rankStyle,
      suitMode,
      allowedSuits,
      cards: explicitCards,
      flipId: typeof patch.flipId === 'string' ? patch.flipId : prev.flipId,
      startedAt: normalizeInteger(patch.startedAt) ?? prev.startedAt,
      resolvedAt: normalizeInteger(patch.resolvedAt) ?? prev.resolvedAt,
      updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
      animationSeed: normalizeInteger(patch.animationSeed) ?? prev.animationSeed,
      validationMessage:
        typeof patch.validationMessage === 'string'
          ? patch.validationMessage
          : prev.validationMessage,
    };
  }

  const shouldFlip = patch.flip === true || typeof patch.flipId === 'string';
  if (shouldFlip) {
    const flip = flipCards({
      drawCount,
      layoutMode,
      rankMin,
      rankMax,
      suitMode,
      allowedSuits,
      timestamp,
      random,
    });
    return {
      drawCount,
      layoutMode,
      rankMin,
      rankMax,
      rankStyle,
      suitMode,
      allowedSuits,
      cards: flip.cards,
      flipId:
        typeof patch.flipId === 'string' ? patch.flipId : nextActionId('flip', timestamp, random),
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
    layoutMode,
    rankMin,
    rankMax,
    rankStyle,
    suitMode,
    allowedSuits,
    cards: prev.cards.slice(0, drawCount),
    updatedAt: normalizeInteger(patch.updatedAt) ?? timestamp,
    validationMessage:
      typeof patch.validationMessage === 'string'
        ? patch.validationMessage
        : prev.validationMessage,
  };
}

export function rollDice({
  diceCount,
  diceSides,
  layoutMode,
  timestamp,
  random = Math.random,
}: RollDiceArgs) {
  const sides = normalizeDiceSides(diceSides, diceCount, undefined, undefined, diceSides);
  const values = sides.map((sideCount) =>
    clamp(Math.floor(random() * sideCount) + 1, 1, sideCount),
  );
  return {
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    groupTotals: computeDiceTotals(values, layoutMode),
    animationSeed: Math.floor(random() * 10_000) + (timestamp % 1_000),
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

  const timestamp =
    normalizeInteger(patch.updatedAt) ?? normalizeInteger(patch.startedAt) ?? Date.now();
  const diceCount = clamp(normalizeInteger(patch.diceCount) ?? prev.diceCount, 1, MAX_DICE_COUNT);
  const layoutMode = normalizeDiceLayoutMode(patch.layoutMode ?? prev.layoutMode);
  const diceSides = normalizeDiceSides(
    patch.diceSides,
    diceCount,
    patch.dieOneSides,
    patch.dieTwoSides,
    prev.diceSides,
  );
  const rollId =
    typeof patch.rollId === 'string'
      ? patch.rollId
      : `agent-roll-v${normalizeInteger(patch.version) ?? prev.updatedAt}-${layoutMode}-${diceSides.join('-')}`;
  const random = createSeededRandom(
    deriveDeterministicSeed({
      actionId: rollId,
      timestamp,
      version: normalizeInteger(patch.version) ?? null,
      config: { diceCount, layoutMode, diceSides },
    }),
  );
  const result = rollDice({ diceCount, diceSides, layoutMode, timestamp, random });
  return {
    ...patch,
    diceCount,
    diceSides,
    layoutMode,
    rollId,
    startedAt: normalizeInteger(patch.startedAt) ?? timestamp,
    resolvedAt: normalizeInteger(patch.resolvedAt) ?? timestamp,
    updatedAt: timestamp,
    values: result.values,
    total: result.total,
    groupTotals: result.groupTotals,
    animationSeed: result.animationSeed,
  };
}

export function flipCards({
  drawCount,
  layoutMode,
  rankMin,
  rankMax,
  suitMode,
  allowedSuits,
  timestamp,
  random = Math.random,
}: FlipCardsArgs) {
  const pool = buildAllowedCardPool(rankMin, rankMax, allowedSuits, suitMode);
  const desiredCount = clamp(drawCount, 1, MAX_CARD_DRAW_COUNT);
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
    layoutMode,
    animationSeed: Math.floor(random() * 10_000) + (timestamp % 1_000),
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

  const timestamp =
    normalizeInteger(patch.updatedAt) ?? normalizeInteger(patch.startedAt) ?? Date.now();
  const drawCount = clamp(
    normalizeInteger(patch.drawCount) ?? prev.drawCount,
    1,
    MAX_CARD_DRAW_COUNT,
  );
  const layoutMode = normalizeCardLayoutMode(patch.layoutMode ?? prev.layoutMode);
  const rankMin = clamp(normalizeInteger(patch.rankMin) ?? prev.rankMin, 1, 13);
  const rankMax = Math.max(rankMin, clamp(normalizeInteger(patch.rankMax) ?? prev.rankMax, 1, 13));
  const suitMode = inferSuitMode(
    patch.suitMode ?? prev.suitMode,
    patch.allowedSuits ?? prev.allowedSuits,
  );
  const allowedSuits = normalizeAllowedSuitsForMode(
    suitMode,
    Object.prototype.hasOwnProperty.call(patch, 'allowedSuits')
      ? patch.allowedSuits
      : prev.allowedSuits,
  );
  const rankStyle = normalizeRankStyle(patch.rankStyle ?? prev.rankStyle);
  const flipId =
    typeof patch.flipId === 'string'
      ? patch.flipId
      : `agent-flip-v${normalizeInteger(patch.version) ?? prev.updatedAt}-${layoutMode}-${rankMin}-${rankMax}-${suitMode}-${allowedSuits.join('-')}`;
  const random = createSeededRandom(
    deriveDeterministicSeed({
      actionId: flipId,
      timestamp,
      version: normalizeInteger(patch.version) ?? null,
      config: { drawCount, layoutMode, rankMin, rankMax, suitMode, allowedSuits, rankStyle },
    }),
  );
  const result = flipCards({
    drawCount,
    layoutMode,
    rankMin,
    rankMax,
    suitMode,
    allowedSuits,
    timestamp,
    random,
  });
  return {
    ...patch,
    drawCount,
    layoutMode,
    rankMin,
    rankMax,
    rankStyle,
    suitMode,
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

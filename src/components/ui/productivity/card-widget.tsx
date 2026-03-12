'use client';

import { useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/shared/button';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { WidgetFrame } from './widget-frame';
import {
  type CardLayoutMode,
  type CardRankStyle,
  type CardRuntimeState,
  CARD_ANIMATION_MS,
  CARD_SUITS,
  type CardSuit,
  type CardSuitMode,
  cardLabel,
  cardWidgetSchema,
  describeSuitMode,
  MAX_CARD_DRAW_COUNT,
  parseCardRuntimeState,
  rankLabel,
  reduceCardRuntimeState,
  resolveCardAgentPatch,
  shortRankLabel,
  suitSymbol,
  suitTone,
} from './game-widget-utils';
import {
  useReplayWindow,
  useSharedGameAnimationStyles,
  useSharedWidgetRuntime,
} from './use-shared-widget-runtime';

export { cardWidgetSchema };

type CardWidgetProps = {
  title?: string;
  drawCount?: number;
  layoutMode?: CardLayoutMode;
  rankMin?: number;
  rankMax?: number;
  rankStyle?: CardRankStyle;
  suitMode?: CardSuitMode;
  allowedSuits?: CardSuit[];
  flip?: boolean;
  __custom_message_id?: string;
  messageId?: string;
  contextKey?: string;
  className?: string;
  state?: Record<string, unknown>;
  updateState?: (
    patch:
      | Record<string, unknown>
      | ((prev: Record<string, unknown> | undefined) => Record<string, unknown>),
  ) => void;
};

const SUIT_LABELS: Record<CardSuit, string> = {
  spades: 'Spades',
  hearts: 'Hearts',
  clubs: 'Clubs',
  diamonds: 'Diamonds',
};

function createInitialRuntime(props: CardWidgetProps): CardRuntimeState {
  return parseCardRuntimeState({
    drawCount: props.drawCount,
    layoutMode: props.layoutMode,
    rankMin: props.rankMin,
    rankMax: props.rankMax,
    rankStyle: props.rankStyle,
    suitMode: props.suitMode,
    allowedSuits: props.allowedSuits,
  });
}

function PlayingCard({
  rankValue,
  rankStyle,
  suit,
  isFlipping,
  compact,
}: {
  rankValue: number;
  rankStyle: CardRankStyle;
  suit: CardSuit | null;
  isFlipping: boolean;
  compact?: boolean;
}) {
  const label = shortRankLabel(rankValue, rankStyle);
  const symbol = suitSymbol(suit);
  const tone = suitTone(suit);
  const showSuit = suit !== null;

  return (
    <div className="relative [perspective:1400px]">
      <div
        className={cn(
          'absolute inset-x-[12%] top-[82%] h-5 rounded-full bg-black/20 blur-xl',
          isFlipping && 'animate-[present-card-shadow_1200ms_cubic-bezier(.22,.86,.33,1)]',
        )}
      />
      <div
        className={cn(
          'group relative rounded-[26px] border p-4 [transform-style:preserve-3d] transition-transform duration-700',
          compact ? 'h-44' : 'h-52',
          isFlipping && 'animate-[present-card-flip_1200ms_cubic-bezier(.22,.86,.33,1)]',
        )}
        style={{
          background:
            'linear-gradient(155deg, rgba(255,251,245,1), rgba(252,246,238,0.98) 52%, rgba(240,235,227,1))',
          borderColor: 'rgba(148, 163, 184, 0.35)',
          boxShadow: '0 20px 35px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.5)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-[8px] rounded-[20px]"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.32), transparent 26%, rgba(148,163,184,0.1) 100%)',
            transform: 'translateZ(22px)',
          }}
        />
        <div className={cn('flex justify-between text-xl font-semibold', tone)}>
          <div>{label}</div>
          <div>{showSuit ? symbol : '·'}</div>
        </div>
        <div className="flex h-full items-center justify-center">
          <div className={cn(compact ? 'text-5xl' : 'text-6xl', tone)}>
            {showSuit ? symbol : label}
          </div>
        </div>
        <div className={cn('flex justify-between text-xl font-semibold', tone)}>
          <div className="rotate-180">{label}</div>
          <div className="rotate-180">{showSuit ? symbol : '·'}</div>
        </div>
      </div>
    </div>
  );
}

function CardGroup({
  title,
  subtitle,
  cards,
  rankStyle,
  isFlipping,
  compact,
}: {
  title: string;
  subtitle: string;
  cards: CardRuntimeState['cards'];
  rankStyle: CardRankStyle;
  isFlipping: boolean;
  compact: boolean;
}) {
  const groupTotal = cards.reduce((sum, card) => sum + card.rankValue, 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="mb-3 flex items-center justify-between text-white">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">{title}</div>
          <div className="mt-1 text-sm text-emerald-50/90">{subtitle}</div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs">
          Total {groupTotal}
        </div>
      </div>

      <div className={cn('grid gap-3', cards.length <= 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {cards.length > 0
          ? cards.map((card) => (
              <PlayingCard
                key={`${title}-${card.id}`}
                rankValue={card.rankValue}
                rankStyle={rankStyle}
                suit={card.suit}
                isFlipping={isFlipping}
                compact={compact}
              />
            ))
          : Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className={cn(
                  'rounded-[26px] border border-dashed border-white/20 bg-black/10',
                  compact ? 'h-44' : 'h-52',
                )}
              />
            ))}
      </div>
    </div>
  );
}

export function CardWidget(props: CardWidgetProps) {
  const {
    __custom_message_id,
    messageId: propMessageId,
    contextKey,
    className,
    title,
    state,
    updateState,
  } = props;

  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `card-widget-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const initialRuntime = useMemo(
    () =>
      createInitialRuntime({
        drawCount: props.drawCount,
        layoutMode: props.layoutMode,
        rankMin: props.rankMin,
        rankMax: props.rankMax,
        rankStyle: props.rankStyle,
        suitMode: props.suitMode,
        allowedSuits: props.allowedSuits,
      }),
    [
      props.allowedSuits,
      props.drawCount,
      props.layoutMode,
      props.rankMax,
      props.rankMin,
      props.rankStyle,
      props.suitMode,
    ],
  );

  const parseState = useCallback(
    (raw: unknown) => {
      const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return parseCardRuntimeState({ ...initialRuntime, ...source });
    },
    [initialRuntime],
  );

  const reduceState = useCallback(
    (prev: CardRuntimeState, patch: Record<string, unknown>, timestamp: number) => {
      const baseline = {
        ...prev,
        drawCount: prev.drawCount || initialRuntime.drawCount,
        layoutMode: prev.layoutMode || initialRuntime.layoutMode,
        rankMin: prev.rankMin || initialRuntime.rankMin,
        rankMax: prev.rankMax || initialRuntime.rankMax,
        rankStyle: prev.rankStyle || initialRuntime.rankStyle,
        suitMode: prev.suitMode || initialRuntime.suitMode,
        allowedSuits:
          prev.allowedSuits.length > 0 ? prev.allowedSuits : initialRuntime.allowedSuits,
      };
      return reduceCardRuntimeState(baseline, patch, timestamp);
    },
    [initialRuntime],
  );

  const { runtime, pushRuntimePatch } = useSharedWidgetRuntime({
    injectedState: state,
    updateState,
    parseState,
    reduceState,
  });
  useSharedGameAnimationStyles();

  const isFlipping = useReplayWindow(runtime.flipId, runtime.startedAt, CARD_ANIMATION_MS);

  const registryProps = useMemo(
    () => ({
      title: title || 'Card Flip',
      drawCount: runtime.drawCount,
      layoutMode: runtime.layoutMode,
      rankMin: runtime.rankMin,
      rankMax: runtime.rankMax,
      rankStyle: runtime.rankStyle,
      suitMode: runtime.suitMode,
      allowedSuits: runtime.allowedSuits,
      cards: runtime.cards,
      flipId: runtime.flipId,
      startedAt: runtime.startedAt,
      resolvedAt: runtime.resolvedAt,
      updatedAt: runtime.updatedAt,
      validationMessage: runtime.validationMessage,
      className,
    }),
    [className, runtime, title],
  );

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      pushRuntimePatch(resolveCardAgentPatch(patch, runtime));
    },
    [pushRuntimePatch, runtime],
  );

  useComponentRegistration(
    messageId,
    'CardWidget',
    registryProps,
    contextKey || 'canvas',
    handleAIUpdate,
  );

  const flipCards = useCallback(() => {
    pushRuntimePatch({ flip: true });
  }, [pushRuntimePatch]);

  const setSuitMode = useCallback(
    (mode: CardSuitMode) => {
      if (mode === 'all') {
        pushRuntimePatch({ suitMode: mode, allowedSuits: [...CARD_SUITS] });
        return;
      }
      if (mode === 'none') {
        pushRuntimePatch({ suitMode: mode, allowedSuits: [] });
        return;
      }
      pushRuntimePatch({
        suitMode: mode,
        allowedSuits: runtime.allowedSuits.length > 0 ? runtime.allowedSuits : ['hearts', 'spades'],
      });
    },
    [pushRuntimePatch, runtime.allowedSuits],
  );

  const updateSuit = useCallback(
    (suit: CardSuit) => {
      const hasSuit = runtime.allowedSuits.includes(suit);
      const next = hasSuit
        ? runtime.allowedSuits.filter((entry) => entry !== suit)
        : [...runtime.allowedSuits, suit];
      pushRuntimePatch({
        suitMode: next.length === 0 ? 'none' : next.length === CARD_SUITS.length ? 'all' : 'custom',
        allowedSuits: next,
      });
    },
    [pushRuntimePatch, runtime.allowedSuits],
  );

  const groups = useMemo(() => {
    if (runtime.layoutMode !== 'versus') {
      return [
        {
          title: 'Main Reveal',
          subtitle:
            runtime.cards.length > 0
              ? runtime.cards.map((card) => cardLabel(card, runtime.rankStyle)).join(' · ')
              : 'No cards flipped yet',
          cards: runtime.cards.slice(0, runtime.drawCount),
        },
      ];
    }

    const splitIndex = Math.ceil(runtime.drawCount / 2);
    const sideBCount = runtime.drawCount - splitIndex;
    return [
      {
        title: 'Side A',
        subtitle: `${splitIndex} card${splitIndex === 1 ? '' : 's'}`,
        expectedCount: splitIndex,
        cards: runtime.cards.slice(0, splitIndex),
      },
      {
        title: 'Side B',
        subtitle: `${sideBCount} card${sideBCount === 1 ? '' : 's'}`,
        expectedCount: sideBCount,
        cards: runtime.cards.slice(splitIndex),
      },
    ].filter((group) => group.expectedCount > 0 || group.cards.length > 0);
  }, [runtime]);

  const compactCards = runtime.drawCount >= 5;
  const versusSummary =
    runtime.layoutMode === 'versus' && groups.length === 2
      ? `${groups[0]!.cards.reduce((sum, card) => sum + card.rankValue, 0)} vs ${groups[1]!.cards.reduce((sum, card) => sum + card.rankValue, 0)}`
      : `${runtime.cards.length} shown`;

  return (
    <WidgetFrame
      title={title || 'Card Flip'}
      subtitle={`${rankLabel(runtime.rankMin, runtime.rankStyle)} to ${rankLabel(runtime.rankMax, runtime.rankStyle)}`}
      meta={runtime.validationMessage || describeSuitMode(runtime.suitMode, runtime.allowedSuits)}
      actions={
        <Button
          size="sm"
          onClick={flipCards}
          className="border-0 text-white shadow-[0_12px_30px_rgba(239,68,68,0.24)]"
          style={{
            background: 'linear-gradient(135deg, #be123c, #7c2d12)',
          }}
        >
          Flip
        </Button>
      }
      className={cn('overflow-hidden border-0 shadow-[0_30px_70px_rgba(15,23,42,0.28)]', className)}
      bodyClassName="space-y-3"
    >
      <div
        className="rounded-[28px] border px-3 py-3"
        style={{
          background:
            'radial-gradient(circle at 18% 20%, rgba(250,204,21,0.16), transparent 36%), linear-gradient(155deg, #1b4332, #10261f 55%, #07120d 100%)',
          borderColor: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -18px 36px rgba(0,0,0,0.22)',
        }}
      >
        <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-2.5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">
                  Deal Setup
                </div>
                <div className="mt-1 text-sm text-emerald-50/85">{versusSummary}</div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-emerald-50/85">
                {runtime.cards.length} shown
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <label className="block text-[11px] text-emerald-100/70">
                Cards to flip
                <input
                  type="range"
                  min={1}
                  max={MAX_CARD_DRAW_COUNT}
                  value={runtime.drawCount}
                  onChange={(event) => pushRuntimePatch({ drawCount: Number(event.target.value) })}
                  className="mt-2 w-full"
                />
                <span className="mt-1 block text-sm text-white">{runtime.drawCount}</span>
              </label>

              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/60">
                  Layout
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['fan', 'Fan'],
                      ['versus', 'Versus'],
                    ] as const
                  ).map(([mode, label]) => {
                    const active = runtime.layoutMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => pushRuntimePatch({ layoutMode: mode })}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-sm transition',
                          active
                            ? 'border-sky-300/70 bg-sky-200/15 text-sky-50'
                            : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-emerald-100/70">
                Min rank
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none"
                  value={runtime.rankMin}
                  onChange={(event) => pushRuntimePatch({ rankMin: Number(event.target.value) })}
                >
                  {Array.from({ length: 13 }).map((_, index) => {
                    const rank = index + 1;
                    return (
                      <option key={rank} value={rank}>
                        {rankLabel(rank, runtime.rankStyle)}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="text-[11px] text-emerald-100/70">
                Max rank
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none"
                  value={runtime.rankMax}
                  onChange={(event) => pushRuntimePatch({ rankMax: Number(event.target.value) })}
                >
                  {Array.from({ length: 13 }).map((_, index) => {
                    const rank = index + 1;
                    return (
                      <option key={rank} value={rank}>
                        {rankLabel(rank, runtime.rankStyle)}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/60">
                  Rank labels
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['classic', 'Classic'],
                      ['numeric', 'Numeric'],
                    ] as const
                  ).map(([mode, label]) => {
                    const active = runtime.rankStyle === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          pushRuntimePatch({
                            rankStyle: mode,
                            ...(mode === 'numeric'
                              ? { rankMax: Math.min(runtime.rankMax, 10) }
                              : {}),
                          })
                        }
                        className={cn(
                          'rounded-xl border px-3 py-2 text-sm transition',
                          active
                            ? 'border-amber-300/70 bg-amber-200/15 text-amber-50'
                            : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/60">
                  Suit mode
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ['all', 'All'],
                      ['custom', 'Custom'],
                      ['none', 'None'],
                    ] as const
                  ).map(([mode, label]) => {
                    const active = runtime.suitMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSuitMode(mode)}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-sm transition',
                          active
                            ? 'border-emerald-300/70 bg-emerald-200/15 text-emerald-50'
                            : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {runtime.suitMode !== 'none' ? (
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {CARD_SUITS.map((suit) => {
                  const active =
                    runtime.suitMode === 'all' ? true : runtime.allowedSuits.includes(suit);
                  return (
                    <button
                      key={suit}
                      type="button"
                      onClick={() => updateSuit(suit)}
                      className={cn(
                        'rounded-xl border px-2.5 py-2 text-left text-sm transition',
                        active
                          ? 'border-amber-300/70 bg-amber-200/15 text-amber-50'
                          : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                      )}
                    >
                      <div className="text-lg">{suitSymbol(suit)}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.16em]">
                        {SUIT_LABELS[suit]}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="space-y-2.5">
            <div className="mb-1 flex items-center justify-between gap-3 text-white">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">
                  Reveal
                </div>
                <div className="mt-1 text-sm text-emerald-50">{versusSummary}</div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/15 px-2.5 py-1 text-[11px]">
                {runtime.cards.length} shown
              </div>
            </div>

            <div
              className={cn('grid gap-2.5', groups.length === 1 ? 'grid-cols-1' : 'xl:grid-cols-2')}
            >
              {groups.map((group) => (
                <CardGroup
                  key={group.title}
                  title={group.title}
                  subtitle={group.subtitle}
                  cards={group.cards}
                  rankStyle={runtime.rankStyle}
                  isFlipping={isFlipping}
                  compact={compactCards}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </WidgetFrame>
  );
}

export default CardWidget;

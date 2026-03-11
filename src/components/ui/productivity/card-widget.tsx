'use client';

import { useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/shared/button';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { WidgetFrame } from './widget-frame';
import {
  type CardRuntimeState,
  CARD_ANIMATION_MS,
  CARD_SUITS,
  type CardSuit,
  cardLabel,
  cardWidgetSchema,
  parseCardRuntimeState,
  reduceCardRuntimeState,
  resolveCardAgentPatch,
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
  rankMin?: number;
  rankMax?: number;
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

const rankLabel = (value: number) => {
  if (value === 1) return 'Ace';
  if (value === 11) return 'Jack';
  if (value === 12) return 'Queen';
  if (value === 13) return 'King';
  return String(value);
};

function createInitialRuntime(props: CardWidgetProps): CardRuntimeState {
  return parseCardRuntimeState({
    drawCount: props.drawCount,
    rankMin: props.rankMin,
    rankMax: props.rankMax,
    allowedSuits: props.allowedSuits,
  });
}

function PlayingCard({
  label,
  suit,
  isFlipping,
}: {
  label: string;
  suit: CardSuit;
  isFlipping: boolean;
}) {
  return (
    <div
      className={cn(
        'group relative h-52 rounded-[26px] [transform-style:preserve-3d] transition-transform duration-700',
        isFlipping && 'animate-[present-card-flip_1100ms_cubic-bezier(.22,.86,.33,1)]',
      )}
    >
      <div
        className="absolute inset-0 rounded-[26px] border p-4 shadow-[0_20px_35px_rgba(15,23,42,0.16)]"
        style={{
          background:
            'linear-gradient(155deg, rgba(255,250,240,1), rgba(253,248,240,0.96) 55%, rgba(247,242,233,1))',
          borderColor: 'rgba(148, 163, 184, 0.35)',
        }}
      >
        <div className={cn('flex justify-between text-xl font-semibold', suitTone(suit))}>
          <div>{label}</div>
          <div>{suitSymbol(suit)}</div>
        </div>
        <div className="flex h-full items-center justify-center">
          <div className={cn('text-6xl leading-none', suitTone(suit))}>{suitSymbol(suit)}</div>
        </div>
        <div className={cn('flex justify-between text-xl font-semibold', suitTone(suit))}>
          <div className="rotate-180">{label}</div>
          <div className="rotate-180">{suitSymbol(suit)}</div>
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-0 rounded-[26px]"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.24), transparent 25%, rgba(148,163,184,0.14) 100%)',
        }}
      />
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
    () => createInitialRuntime(props),
    [props.allowedSuits, props.drawCount, props.rankMax, props.rankMin],
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
        rankMin: prev.rankMin || initialRuntime.rankMin,
        rankMax: prev.rankMax || initialRuntime.rankMax,
        allowedSuits: prev.allowedSuits.length > 0 ? prev.allowedSuits : initialRuntime.allowedSuits,
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
      rankMin: runtime.rankMin,
      rankMax: runtime.rankMax,
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

  const updateSuit = useCallback(
    (suit: CardSuit) => {
      const hasSuit = runtime.allowedSuits.includes(suit);
      const next = hasSuit
        ? runtime.allowedSuits.filter((entry) => entry !== suit)
        : [...runtime.allowedSuits, suit];
      if (next.length === 0) {
        return;
      }
      pushRuntimePatch({ allowedSuits: next });
    },
    [pushRuntimePatch, runtime.allowedSuits],
  );

  const previewCards = runtime.cards.slice(0, runtime.drawCount);

  return (
    <WidgetFrame
      title={title || 'Card Flip'}
      subtitle={`${rankLabel(runtime.rankMin)} to ${rankLabel(runtime.rankMax)}`}
      meta={runtime.validationMessage || `${runtime.allowedSuits.length} suit${runtime.allowedSuits.length === 1 ? '' : 's'} in play`}
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
      className={cn(
        'overflow-hidden border-0 shadow-[0_30px_70px_rgba(15,23,42,0.28)]',
        className,
      )}
      bodyClassName="space-y-4"
    >
      <div
        className="rounded-[28px] border px-4 py-4"
        style={{
          background:
            'radial-gradient(circle at 18% 20%, rgba(250,204,21,0.16), transparent 36%), linear-gradient(155deg, #1b4332, #10261f 55%, #07120d 100%)',
          borderColor: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -18px 36px rgba(0,0,0,0.22)',
        }}
      >
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-3 text-white">
            <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">Deal Setup</div>
            <label className="mt-3 block text-xs text-emerald-100/70">
              Cards to flip
              <input
                type="range"
                min={1}
                max={5}
                value={runtime.drawCount}
                onChange={(event) => pushRuntimePatch({ drawCount: Number(event.target.value) })}
                className="mt-2 w-full"
              />
              <span className="mt-1 block text-sm text-white">{runtime.drawCount}</span>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs text-emerald-100/70">
                Min rank
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  value={runtime.rankMin}
                  onChange={(event) => pushRuntimePatch({ rankMin: Number(event.target.value) })}
                >
                  {Array.from({ length: 13 }).map((_, index) => {
                    const rank = index + 1;
                    return (
                      <option key={rank} value={rank}>
                        {rankLabel(rank)}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="text-xs text-emerald-100/70">
                Max rank
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  value={runtime.rankMax}
                  onChange={(event) => pushRuntimePatch({ rankMax: Number(event.target.value) })}
                >
                  {Array.from({ length: 13 }).map((_, index) => {
                    const rank = index + 1;
                    return (
                      <option key={rank} value={rank}>
                        {rankLabel(rank)}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/60">Suits</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {CARD_SUITS.map((suit) => {
                  const active = runtime.allowedSuits.includes(suit);
                  return (
                    <button
                      key={suit}
                      type="button"
                      onClick={() => updateSuit(suit)}
                      className={cn(
                        'rounded-2xl border px-3 py-2 text-left text-sm transition',
                        active
                          ? 'border-amber-300/70 bg-amber-200/15 text-amber-50'
                          : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                      )}
                    >
                      <div className="text-lg">{suitSymbol(suit)}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em]">{SUIT_LABELS[suit]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-3 flex items-center justify-between text-white">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">Reveal</div>
                <div className="mt-1 text-sm text-emerald-50">
                  {previewCards.length > 0 ? previewCards.map((card) => cardLabel(card)).join(' · ') : 'No cards flipped yet'}
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs">
                {previewCards.length} shown
              </div>
            </div>

            <div
              className={cn(
                'grid gap-3',
                previewCards.length <= 1 ? 'grid-cols-1' : previewCards.length <= 2 ? 'grid-cols-2' : 'grid-cols-3',
              )}
            >
              {previewCards.length > 0 ? (
                previewCards.map((card) => (
                  <PlayingCard
                    key={`${runtime.flipId || 'card'}-${card.id}`}
                    label={card.rank}
                    suit={card.suit}
                    isFlipping={isFlipping}
                  />
                ))
              ) : (
                Array.from({ length: runtime.drawCount }).map((_, index) => (
                  <div
                    key={index}
                    className="h-52 rounded-[26px] border border-dashed border-white/20 bg-black/10"
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </WidgetFrame>
  );
}

export default CardWidget;

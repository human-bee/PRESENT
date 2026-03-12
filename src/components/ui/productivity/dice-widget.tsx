'use client';

import { useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/shared/button';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { WidgetFrame } from './widget-frame';
import {
  type DiceLayoutMode,
  type DiceRuntimeState,
  DICE_ANIMATION_MS,
  diceWidgetSchema,
  parseDiceRuntimeState,
  reduceDiceRuntimeState,
  resolveDiceAgentPatch,
} from './game-widget-utils';
import {
  useReplayWindow,
  useSharedGameAnimationStyles,
  useSharedWidgetRuntime,
} from './use-shared-widget-runtime';

export { diceWidgetSchema };

type DiceWidgetProps = {
  title?: string;
  diceCount?: number;
  diceSides?: number[];
  dieOneSides?: number;
  dieTwoSides?: number;
  layoutMode?: DiceLayoutMode;
  roll?: boolean;
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

const SIDE_PRESETS = [4, 6, 8, 10, 12, 20, 100];

const valueToPips: Record<number, number[][]> = {
  1: [[4]],
  2: [[0, 8]],
  3: [[0, 4, 8]],
  4: [[0, 2, 6, 8]],
  5: [[0, 2, 4, 6, 8]],
  6: [[0, 2, 3, 5, 6, 8]],
};

function createPolygonPoints(edges: number, radius = 46, rotationDeg = -90) {
  const points: string[] = [];
  const center = 50;
  const rotation = (rotationDeg * Math.PI) / 180;
  for (let index = 0; index < edges; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / edges;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}

function polygonEdgesForSides(sides: number) {
  if (sides <= 8) return 8;
  if (sides <= 10) return 10;
  if (sides <= 12) return 12;
  if (sides <= 20) return 14;
  return 16;
}

function FacetedDieToken({
  value,
  sides,
  compact,
}: {
  value: number;
  sides: number;
  compact: boolean;
}) {
  const polygon = createPolygonPoints(polygonEdgesForSides(sides), compact ? 42 : 45);
  const innerPolygon = createPolygonPoints(polygonEdgesForSides(sides), compact ? 33 : 36);
  const valueSizeClass =
    value >= 100
      ? compact
        ? 'text-[1.15rem]'
        : 'text-[1.45rem]'
      : compact
        ? 'text-[1.65rem]'
        : 'text-[2.05rem]';

  return (
    <div className="relative flex h-full items-center justify-center">
      <svg
        viewBox="0 0 100 100"
        className={cn(
          'drop-shadow-[0_16px_22px_rgba(2,6,23,0.2)]',
          compact ? 'h-20 w-20' : 'h-24 w-24',
        )}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`present-die-${sides}-fill`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff9ea" />
            <stop offset="56%" stopColor="#f4e5bf" />
            <stop offset="100%" stopColor="#d9b66a" />
          </linearGradient>
          <linearGradient id={`present-die-${sides}-stroke`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f0c85d" />
            <stop offset="100%" stopColor="#7c4a12" />
          </linearGradient>
        </defs>
        <polygon
          points={polygon}
          fill={`url(#present-die-${sides}-fill)`}
          stroke={`url(#present-die-${sides}-stroke)`}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <polygon
          points={innerPolygon}
          fill="none"
          stroke="rgba(120,53,15,0.08)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <path d="M50 10 L66 34 L50 90 L34 34 Z" fill="rgba(255,255,255,0.06)" />
        <path
          d="M10 50 L34 34 L66 34 L90 50"
          fill="none"
          stroke="rgba(69,26,3,0.08)"
          strokeWidth="1"
        />
        <path d="M10 50 L50 90 L90 50" fill="none" stroke="rgba(69,26,3,0.08)" strokeWidth="1" />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="absolute inset-x-[26%] top-[24%] h-[36%] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(255,250,235,0.84) 0%, rgba(255,250,235,0.56) 52%, rgba(255,250,235,0) 100%)',
          }}
        />
        <div
          className={cn(
            'font-mono font-black leading-none text-black [text-shadow:0_1px_0_rgba(255,255,255,0.82)]',
            valueSizeClass,
          )}
        >
          {value}
        </div>
        <div className="mt-1 rounded-full bg-slate-950/88 px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-[0.18em] text-amber-50 shadow-sm">
          d{sides}
        </div>
      </div>
    </div>
  );
}

function createInitialRuntime(props: DiceWidgetProps): DiceRuntimeState {
  return parseDiceRuntimeState({
    diceCount: props.diceCount,
    diceSides: props.diceSides,
    dieOneSides: props.dieOneSides,
    dieTwoSides: props.dieTwoSides,
    layoutMode: props.layoutMode,
  });
}

function DiceFace({
  value,
  sides,
  isRolling,
  compact = false,
}: {
  value: number;
  sides: number;
  isRolling: boolean;
  compact?: boolean;
}) {
  const pipLayout = sides <= 6 ? (valueToPips[Math.min(6, Math.max(1, value))] ?? [[4]]) : null;
  const usePips = sides <= 6 && pipLayout;

  return (
    <div className="relative mx-auto w-full max-w-[104px] [perspective:1200px]">
      <div
        className={cn(
          'absolute left-[18%] right-[18%] top-[84%] h-4 rounded-full bg-black/18 blur-lg',
          isRolling && 'animate-[present-dice-shadow_1250ms_cubic-bezier(.24,.8,.25,1)]',
        )}
      />
      <div
        className={cn(
          'relative aspect-square overflow-hidden transition-transform duration-150',
          isRolling && 'animate-[present-dice-bounce_1250ms_cubic-bezier(.24,.8,.25,1)]',
        )}
      >
        {usePips ? (
          <div
            className="relative aspect-square overflow-hidden rounded-[22px] border"
            style={{
              background:
                'linear-gradient(165deg, rgba(255,255,255,0.99), rgba(244,246,249,0.97) 48%, rgba(223,229,238,0.98) 100%)',
              borderColor: 'rgba(148, 163, 184, 0.28)',
              boxShadow:
                '0 14px 26px rgba(2,6,23,0.2), inset 0 1px 0 rgba(255,255,255,0.82), inset 0 -10px 18px rgba(15,23,42,0.06)',
            }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(145deg, rgba(255,255,255,0.55), rgba(255,255,255,0.08) 28%, transparent 55%)',
              }}
            />
            <div className="absolute left-3 top-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              d6
            </div>
            <div
              className={cn(
                'grid h-full grid-cols-3 grid-rows-3',
                compact ? 'gap-2 p-4' : 'gap-3 p-5',
              )}
            >
              {Array.from({ length: 9 }).map((_, index) => {
                const active = pipLayout.some((row) => row.includes(index));
                return (
                  <div
                    key={index}
                    className={cn(
                      'rounded-full transition-all duration-150',
                      active ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
                    )}
                    style={{
                      background: active
                        ? 'radial-gradient(circle at 30% 30%, #020617, #0f172a 72%)'
                        : 'transparent',
                    }}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <FacetedDieToken value={value} sides={sides} compact={compact} />
        )}
      </div>
    </div>
  );
}

function DiceTray({
  title,
  subtitle,
  total,
  values,
  diceSides,
  isRolling,
  compact,
}: {
  title: string;
  subtitle: string;
  total: number;
  values: number[];
  diceSides: number[];
  isRolling: boolean;
  compact: boolean;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/15 p-2.5 text-white">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-100/70">{title}</div>
          <div className="mt-1 text-xs text-emerald-50/90">{subtitle}</div>
        </div>
        <div className="rounded-full border border-white/10 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-medium">
          Total {total}
        </div>
      </div>
      <div className={cn('grid gap-2.5', values.length <= 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {values.map((value, index) => (
          <DiceFace
            key={`${title}-${index}-${diceSides[index]}`}
            value={value}
            sides={diceSides[index] ?? 6}
            isRolling={isRolling}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

export function DiceWidget(props: DiceWidgetProps) {
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
    fallbackIdRef.current = `dice-widget-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const initialRuntime = useMemo(
    () =>
      createInitialRuntime({
        diceCount: props.diceCount,
        diceSides: props.diceSides,
        dieOneSides: props.dieOneSides,
        dieTwoSides: props.dieTwoSides,
        layoutMode: props.layoutMode,
      }),
    [props.diceCount, props.diceSides, props.dieOneSides, props.dieTwoSides, props.layoutMode],
  );

  const parseState = useCallback(
    (raw: unknown) => {
      const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return parseDiceRuntimeState({ ...initialRuntime, ...source });
    },
    [initialRuntime],
  );

  const reduceState = useCallback(
    (prev: DiceRuntimeState, patch: Record<string, unknown>, timestamp: number) => {
      const baseline = {
        ...prev,
        diceCount: prev.diceCount || initialRuntime.diceCount,
        diceSides: prev.diceSides.length > 0 ? prev.diceSides : initialRuntime.diceSides,
        layoutMode: prev.layoutMode || initialRuntime.layoutMode,
      };
      return reduceDiceRuntimeState(baseline, patch, timestamp);
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

  const isRolling = useReplayWindow(runtime.rollId, runtime.startedAt, DICE_ANIMATION_MS);

  const registryProps = useMemo(
    () => ({
      title: title || 'Dice Table',
      diceCount: runtime.diceCount,
      diceSides: runtime.diceSides,
      layoutMode: runtime.layoutMode,
      values: runtime.values,
      total: runtime.total,
      groupTotals: runtime.groupTotals,
      rollId: runtime.rollId,
      startedAt: runtime.startedAt,
      resolvedAt: runtime.resolvedAt,
      updatedAt: runtime.updatedAt,
      className,
    }),
    [className, runtime, title],
  );

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      pushRuntimePatch(resolveDiceAgentPatch(patch, runtime));
    },
    [pushRuntimePatch, runtime],
  );

  useComponentRegistration(
    messageId,
    'DiceWidget',
    registryProps,
    contextKey || 'canvas',
    handleAIUpdate,
  );

  const rollDice = useCallback(() => {
    pushRuntimePatch({ roll: true });
  }, [pushRuntimePatch]);

  const updateDieCount = useCallback(
    (next: number) => {
      pushRuntimePatch({ diceCount: next });
    },
    [pushRuntimePatch],
  );

  const updateSides = useCallback(
    (index: number, nextSides: number) => {
      const next = runtime.diceSides.slice(0, runtime.diceCount);
      while (next.length < runtime.diceCount) next.push(next.at(-1) ?? 6);
      next[index] = nextSides;
      pushRuntimePatch({ diceSides: next });
    },
    [pushRuntimePatch, runtime.diceCount, runtime.diceSides],
  );

  const toggleLayout = useCallback(
    (next: DiceLayoutMode) => {
      pushRuntimePatch({ layoutMode: next });
    },
    [pushRuntimePatch],
  );

  const groups = useMemo(() => {
    if (runtime.layoutMode !== 'versus') {
      return [
        {
          title: 'Main Pool',
          subtitle: `${runtime.diceCount} die${runtime.diceCount === 1 ? '' : 's'} in the roll`,
          total: runtime.total,
          values: runtime.values,
          diceSides: runtime.diceSides,
        },
      ];
    }

    const splitIndex = Math.ceil(runtime.diceCount / 2);
    return [
      {
        title: 'Side A',
        subtitle: `${splitIndex} die${splitIndex === 1 ? '' : 's'}`,
        total: runtime.groupTotals[0] ?? 0,
        values: runtime.values.slice(0, splitIndex),
        diceSides: runtime.diceSides.slice(0, splitIndex),
      },
      {
        title: 'Side B',
        subtitle: `${runtime.diceCount - splitIndex} die${runtime.diceCount - splitIndex === 1 ? '' : 's'}`,
        total: runtime.groupTotals[1] ?? 0,
        values: runtime.values.slice(splitIndex),
        diceSides: runtime.diceSides.slice(splitIndex),
      },
    ].filter((group) => group.values.length > 0);
  }, [runtime]);

  const compactDice = runtime.diceCount >= 5;
  const versusLead =
    runtime.layoutMode === 'versus' && groups.length === 2
      ? groups[0]!.total === groups[1]!.total
        ? 'Dead heat'
        : groups[0]!.total > groups[1]!.total
          ? 'Side A leads'
          : 'Side B leads'
      : `${runtime.total} total`;
  const summaryText =
    runtime.layoutMode === 'versus'
      ? `${groups[0]?.total ?? 0} against ${groups[1]?.total ?? 0}`
      : runtime.values.map((value, index) => `D${index + 1}: ${value}`).join(' · ');

  return (
    <WidgetFrame
      title={title || 'Dice Table'}
      subtitle={
        runtime.layoutMode === 'versus' ? 'Versus split' : `${runtime.diceCount} die spread`
      }
      meta={runtime.rollId ? versusLead : 'Ready to roll'}
      actions={
        <Button
          size="sm"
          onClick={rollDice}
          className="border-0 text-white shadow-[0_12px_30px_rgba(245,158,11,0.28)]"
          style={{
            background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
          }}
        >
          Roll
        </Button>
      }
      className={cn('overflow-hidden border-0 shadow-[0_30px_70px_rgba(2,6,23,0.35)]', className)}
      bodyClassName="space-y-3"
    >
      <div
        className="rounded-[28px] border px-3 py-3"
        style={{
          background:
            'radial-gradient(circle at 22% 18%, rgba(250,204,21,0.18), transparent 34%), linear-gradient(155deg, #0e4f3b, #063b31 52%, #021915 100%)',
          borderColor: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -22px 40px rgba(0,0,0,0.24)',
        }}
      >
        <div className="grid gap-3 xl:grid-cols-[232px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-2.5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">
                  Table Rules
                </div>
                <div className="mt-1 text-sm text-emerald-50/85">
                  {runtime.layoutMode === 'versus'
                    ? `${groups[0]?.values.length ?? 0} vs ${groups[1]?.values.length ?? 0}`
                    : `${runtime.diceCount} dice in play`}
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-emerald-50/85">
                {runtime.total} total
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/60">
                  Count
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((count) => {
                    const active = runtime.diceCount === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => updateDieCount(count)}
                        className={cn(
                          'rounded-xl border px-2 py-2 text-sm font-medium transition',
                          active
                            ? 'border-amber-300/70 bg-amber-200/15 text-amber-50'
                            : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                        )}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/60">
                  Layout
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['spread', 'Spread'],
                      ['versus', 'Versus'],
                    ] as const
                  ).map(([mode, label]) => {
                    const active = runtime.layoutMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => toggleLayout(mode)}
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

            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/60">
                Dice Mix
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {runtime.diceSides.map((sides, index) => (
                  <label key={index} className="block text-[11px] text-emerald-100/70">
                    Die {index + 1}
                    <select
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none"
                      value={sides}
                      onChange={(event) => updateSides(index, Number(event.target.value))}
                    >
                      {SIDE_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          d{preset}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3 text-white">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">
                  Roll Window
                </div>
                <div className="mt-1 text-sm text-emerald-50">{summaryText}</div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/15 px-2.5 py-1 text-[11px]">
                {versusLead}
              </div>
            </div>

            <div
              className={cn('grid gap-2.5', groups.length === 1 ? 'grid-cols-1' : 'xl:grid-cols-2')}
            >
              {groups.map((group) => (
                <DiceTray
                  key={group.title}
                  title={group.title}
                  subtitle={group.subtitle}
                  total={group.total}
                  values={group.values}
                  diceSides={group.diceSides}
                  isRolling={isRolling}
                  compact={compactDice}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </WidgetFrame>
  );
}

export default DiceWidget;

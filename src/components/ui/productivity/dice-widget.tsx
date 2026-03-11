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
  MAX_DICE_COUNT,
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
  accent,
  compact = false,
}: {
  value: number;
  sides: number;
  isRolling: boolean;
  accent: string;
  compact?: boolean;
}) {
  const pipLayout = sides <= 6 ? (valueToPips[Math.min(6, Math.max(1, value))] ?? [[4]]) : null;
  const usePips = sides <= 6 && pipLayout;

  return (
    <div className="relative [perspective:1200px]">
      <div
        className={cn(
          'absolute left-[12%] right-[12%] top-[78%] h-5 rounded-full bg-black/25 blur-xl',
          isRolling && 'animate-[present-dice-shadow_1250ms_cubic-bezier(.24,.8,.25,1)]',
        )}
      />
      <div
        className={cn(
          'relative rounded-[28px] border [transform-style:preserve-3d] transition-transform duration-150',
          compact ? 'h-28' : 'h-36',
          isRolling && 'animate-[present-dice-bounce_1250ms_cubic-bezier(.24,.8,.25,1)]',
        )}
        style={{
          background:
            'radial-gradient(circle at 24% 18%, rgba(255,255,255,0.96), rgba(244,246,247,0.95) 38%, rgba(212,219,228,0.96) 100%)',
          borderColor: 'rgba(148, 163, 184, 0.42)',
          boxShadow:
            '0 20px 38px rgba(2,6,23,0.28), inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -18px 24px rgba(15,23,42,0.08)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-[8px] rounded-[22px]"
          style={{
            background:
              'linear-gradient(145deg, rgba(255,255,255,0.5), transparent 28%, rgba(15,23,42,0.08) 82%)',
            transform: 'translateZ(28px)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-[6px] top-[-4px] h-7 rounded-[18px] opacity-60"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0))',
            transform: 'rotateX(90deg) translateZ(10px)',
            transformOrigin: 'center top',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset"
          style={{ boxShadow: `inset 0 0 0 1px ${accent}` }}
        />
        <div className="absolute left-4 top-4 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
          d{sides}
        </div>
        {usePips ? (
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
        ) : (
          <div className="flex h-full items-center justify-center">
            <div
              className={cn(
                'rounded-2xl bg-white/70 font-mono font-semibold tracking-[0.12em] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]',
                compact ? 'px-4 py-2 text-3xl' : 'px-6 py-3 text-5xl',
              )}
            >
              {String(value).padStart(2, '0')}
            </div>
          </div>
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
    <div className="rounded-[24px] border border-white/10 bg-black/15 p-3 text-white">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-100/70">{title}</div>
          <div className="mt-1 text-sm text-emerald-50/90">{subtitle}</div>
        </div>
        <div className="rounded-full border border-white/10 bg-emerald-300/10 px-3 py-1 text-xs font-medium">
          Total {total}
        </div>
      </div>
      <div className={cn('grid gap-3', values.length <= 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {values.map((value, index) => (
          <DiceFace
            key={`${title}-${index}-${diceSides[index]}`}
            value={value}
            sides={diceSides[index] ?? 6}
            isRolling={isRolling}
            compact={compact}
            accent="rgba(245, 158, 11, 0.16)"
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
      bodyClassName="space-y-4"
    >
      <div
        className="rounded-[28px] border px-4 py-4"
        style={{
          background:
            'radial-gradient(circle at 22% 18%, rgba(250,204,21,0.18), transparent 34%), linear-gradient(155deg, #0e4f3b, #063b31 52%, #021915 100%)',
          borderColor: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -22px 40px rgba(0,0,0,0.24)',
        }}
      >
        <div className="grid gap-3 xl:grid-cols-[260px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-3 text-white">
            <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">
              Table Rules
            </div>
            <div className="mt-2 text-sm text-emerald-50/85">
              {runtime.layoutMode === 'versus'
                ? `${groups[0]?.values.length ?? 0} vs ${groups[1]?.values.length ?? 0}`
                : `${runtime.diceCount} dice in play`}
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/60">Count</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[1, 2, 4, 6].map((count) => {
                  const active = runtime.diceCount === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => updateDieCount(count)}
                      className={cn(
                        'rounded-2xl border px-3 py-3 text-sm font-medium transition',
                        active
                          ? 'border-amber-300/70 bg-amber-200/15 text-amber-50'
                          : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                      )}
                    >
                      {count}
                    </button>
                  );
                })}
                <div className="col-span-3">
                  <input
                    type="range"
                    min={1}
                    max={MAX_DICE_COUNT}
                    value={runtime.diceCount}
                    onChange={(event) => updateDieCount(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/60">Layout</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
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
                        'rounded-2xl border px-3 py-2 text-sm transition',
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

            <div className="mt-4 space-y-3">
              {runtime.diceSides.map((sides, index) => (
                <label key={index} className="block text-xs text-emerald-100/70">
                  Die {index + 1}
                  <select
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
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

          <div className="space-y-3">
            <div className="flex items-center justify-between text-white">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-100/70">
                  Roll Window
                </div>
                <div className="mt-1 text-sm text-emerald-50">
                  {runtime.layoutMode === 'versus'
                    ? `${groups[0]?.total ?? 0} against ${groups[1]?.total ?? 0}`
                    : runtime.values.map((value, index) => `D${index + 1}: ${value}`).join(' · ')}
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs">
                Grand total {runtime.total}
              </div>
            </div>

            <div
              className={cn('grid gap-3', groups.length === 1 ? 'grid-cols-1' : 'xl:grid-cols-2')}
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

'use client';

import { useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/shared/button';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { WidgetFrame } from './widget-frame';
import {
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
  dieOneSides?: number;
  dieTwoSides?: number;
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

const SIDE_PRESETS = [4, 6, 8, 10, 12, 20];

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
    dieOneSides: props.dieOneSides,
    dieTwoSides: props.dieTwoSides,
  });
}

function DiceFace({
  value,
  sides,
  isRolling,
  accent,
}: {
  value: number;
  sides: number;
  isRolling: boolean;
  accent: string;
}) {
  const pipLayout = sides <= 6 ? valueToPips[Math.min(6, Math.max(1, value))] ?? [[4]] : null;
  const displayValue = String(value).padStart(2, '0');
  const usePips = sides <= 6 && pipLayout;

  return (
    <div
      className={cn(
        'relative h-36 rounded-[28px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_35px_rgba(2,6,23,0.4)] transition-transform duration-150',
        isRolling && 'animate-[present-dice-bounce_950ms_cubic-bezier(.24,.8,.25,1)]',
      )}
      style={{
        background:
          'radial-gradient(circle at 25% 20%, rgba(255,255,255,0.92), rgba(247,247,244,0.94) 42%, rgba(226,228,231,0.98) 100%)',
        borderColor: 'rgba(148, 163, 184, 0.45)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-[28px]"
        style={{
          background:
            'linear-gradient(145deg, rgba(255,255,255,0.45), transparent 30%, rgba(15,23,42,0.1) 90%)',
        }}
      />
      <div
        className="absolute inset-0 rounded-[28px] ring-1 ring-inset"
        style={{ boxShadow: `inset 0 0 0 1px ${accent}` }}
      />
      <div className="absolute left-4 top-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
        d{sides}
      </div>
      {usePips ? (
        <div className="grid h-full grid-cols-3 grid-rows-3 gap-3 p-5">
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
                  background: active ? 'radial-gradient(circle at 30% 30%, #0f172a, #020617 70%)' : 'transparent',
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div
            className="rounded-2xl px-6 py-3 font-mono text-5xl font-semibold tracking-[0.12em] text-slate-900"
            style={{
              background: 'rgba(255,255,255,0.68)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
            }}
          >
            {displayValue}
          </div>
        </div>
      )}
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

  const initialRuntime = useMemo(() => createInitialRuntime(props), [props.diceCount, props.dieOneSides, props.dieTwoSides]);

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
        dieOneSides: prev.dieOneSides || initialRuntime.dieOneSides,
        dieTwoSides: prev.dieTwoSides || initialRuntime.dieTwoSides,
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
      dieOneSides: runtime.dieOneSides,
      dieTwoSides: runtime.dieTwoSides,
      values: runtime.values,
      total: runtime.total,
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
    (field: 'dieOneSides' | 'dieTwoSides', value: number) => {
      pushRuntimePatch({ [field]: value });
    },
    [pushRuntimePatch],
  );

  const summary = runtime.values.map((value, index) => `D${index + 1}: ${value}`).join('  ·  ');

  return (
    <WidgetFrame
      title={title || 'Dice Table'}
      subtitle={runtime.diceCount === 1 ? 'Single die' : 'Twin dice'}
      meta={runtime.rollId ? `Last total ${runtime.total}` : 'Ready to roll'}
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
      className={cn(
        'overflow-hidden border-0 shadow-[0_30px_70px_rgba(2,6,23,0.35)]',
        className,
      )}
      bodyClassName="space-y-4"
    >
      <div
        className="rounded-[28px] border px-4 py-4 text-white"
        style={{
          background:
            'radial-gradient(circle at 20% 18%, rgba(22,163,74,0.34), transparent 40%), linear-gradient(145deg, #0f3c2a, #08281d 62%, #051912)',
          borderColor: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -20px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.32em] text-emerald-100/75">Table Rules</div>
            <div className="mt-1 text-sm font-medium text-emerald-50">{summary}</div>
          </div>
          <div className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-emerald-50">
            Total {runtime.total}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[130px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
            <div className="text-[11px] uppercase tracking-[0.26em] text-emerald-100/65">Count</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[1, 2].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => updateDieCount(count)}
                  className={cn(
                    'rounded-2xl border px-3 py-3 text-lg font-semibold transition',
                    runtime.diceCount === count
                      ? 'border-amber-300/80 bg-amber-200/15 text-amber-50'
                      : 'border-white/10 bg-white/5 text-emerald-50/85 hover:border-white/30',
                  )}
                >
                  {count}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-emerald-100/70">
                Die 1
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  value={runtime.dieOneSides}
                  onChange={(event) => updateSides('dieOneSides', Number(event.target.value))}
                >
                  {SIDE_PRESETS.map((side) => (
                    <option key={side} value={side}>
                      d{side}
                    </option>
                  ))}
                </select>
              </label>
              {runtime.diceCount === 2 ? (
                <label className="block text-xs text-emerald-100/70">
                  Die 2
                  <select
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                    value={runtime.dieTwoSides}
                    onChange={(event) => updateSides('dieTwoSides', Number(event.target.value))}
                  >
                    {SIDE_PRESETS.map((side) => (
                      <option key={side} value={side}>
                        d{side}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className={cn('grid gap-3', runtime.diceCount === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            <DiceFace value={runtime.values[0] ?? 1} sides={runtime.dieOneSides} isRolling={isRolling} accent="rgba(251,191,36,0.5)" />
            {runtime.diceCount === 2 ? (
              <DiceFace value={runtime.values[1] ?? 1} sides={runtime.dieTwoSides} isRolling={isRolling} accent="rgba(96,165,250,0.5)" />
            ) : null}
          </div>
        </div>
      </div>
    </WidgetFrame>
  );
}

export default DiceWidget;

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import {
  CrowdPulseActiveQuestion,
  CrowdPulseFollowUps,
  CrowdPulseHeader,
  CrowdPulseQuestions,
  CrowdPulseScoreboard,
  CrowdPulseStats,
} from './crowd-pulse-sections';
import {
  type CrowdPulseState,
  type CrowdPulseWidgetProps,
} from './crowd-pulse-schema';

export default function CrowdPulseWidget(props: CrowdPulseWidgetProps) {
  const {
    __custom_message_id,
    messageId: propMessageId,
    contextKey,
    className,
    ...initial
  } = props;

  const fallbackIdRef = useRef<string>();
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `crowd-pulse-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const [state, setState] = useState<CrowdPulseState>(() => ({
    title: initial.title ?? 'Crowd Pulse',
    prompt: initial.prompt,
    status: initial.status ?? 'idle',
    handCount: initial.handCount ?? 0,
    peakCount: initial.peakCount ?? 0,
    confidence: initial.confidence ?? 0,
    noiseLevel: initial.noiseLevel ?? 0,
    activeQuestion: initial.activeQuestion,
    questions: initial.questions ?? [],
    scoreboard: initial.scoreboard ?? [],
    followUps: initial.followUps ?? [],
    lastUpdated: initial.lastUpdated,
    demoMode: initial.demoMode ?? false,
    className,
  }));

  const applyPatch = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => {
      const next: CrowdPulseState = { ...prev };
      if (typeof patch.title === 'string') next.title = patch.title;
      if (typeof patch.prompt === 'string') next.prompt = patch.prompt;
      if (typeof patch.status === 'string') {
        const status = patch.status as CrowdPulseState['status'];
        if (status === 'idle' || status === 'counting' || status === 'locked') {
          next.status = status;
        }
      }
      if (typeof patch.handCount === 'number') next.handCount = patch.handCount;
      if (typeof patch.peakCount === 'number') next.peakCount = patch.peakCount;
      if (typeof patch.confidence === 'number') next.confidence = patch.confidence;
      if (typeof patch.noiseLevel === 'number') next.noiseLevel = patch.noiseLevel;
      if (typeof patch.activeQuestion === 'string') next.activeQuestion = patch.activeQuestion;
      if (Array.isArray(patch.questions)) next.questions = patch.questions as CrowdPulseState['questions'];
      if (Array.isArray(patch.scoreboard)) next.scoreboard = patch.scoreboard as CrowdPulseState['scoreboard'];
      if (Array.isArray(patch.followUps)) next.followUps = patch.followUps as string[];
      if (typeof patch.lastUpdated === 'number') next.lastUpdated = patch.lastUpdated;
      if (typeof patch.demoMode === 'boolean') next.demoMode = patch.demoMode;
      return next;
    });
  }, []);

  const registryProps = useMemo(
    () => ({
      title: state.title,
      prompt: state.prompt,
      status: state.status,
      handCount: state.handCount,
      peakCount: state.peakCount,
      confidence: state.confidence,
      noiseLevel: state.noiseLevel,
      activeQuestion: state.activeQuestion,
      questions: state.questions,
      scoreboard: state.scoreboard,
      followUps: state.followUps,
      lastUpdated: state.lastUpdated,
      demoMode: state.demoMode,
      className,
    }),
    [className, state],
  );

  useComponentRegistration(
    messageId,
    'CrowdPulseWidget',
    registryProps,
    contextKey || 'canvas',
    applyPatch,
  );

  const updatedLabel = state.lastUpdated
    ? new Date(state.lastUpdated).toLocaleTimeString()
    : 'Idle';

  return (
    <div
      className={cn(
        'w-full rounded-2xl border border-slate-800/60 bg-slate-950/95 text-white shadow-2xl',
        className,
      )}
    >
      <CrowdPulseHeader
        title={state.title}
        prompt={state.prompt}
        status={state.status}
        updatedLabel={updatedLabel}
      />

      <div className="grid gap-4 p-4">
        <CrowdPulseStats
          demoMode={state.demoMode}
          handCount={state.handCount}
          peakCount={state.peakCount}
          confidence={state.confidence}
          noiseLevel={state.noiseLevel}
        />

        <CrowdPulseActiveQuestion activeQuestion={state.activeQuestion} />

        <div className="grid gap-3 lg:grid-cols-2">
          <CrowdPulseQuestions questions={state.questions} />
          <CrowdPulseScoreboard scoreboard={state.scoreboard} />
        </div>

        <CrowdPulseFollowUps followUps={state.followUps} />
      </div>
    </div>
  );
}

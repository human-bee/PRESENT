'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import {
  CrowdPulseActiveQuestion,
  CrowdPulseFollowUps,
  CrowdPulseQuestions,
  CrowdPulseScoreboard,
  CrowdPulseStats,
} from './crowd-pulse-sections';
import {
  type CrowdPulseState,
  type CrowdPulseWidgetProps,
} from './crowd-pulse-schema';
import {
  getCrowdPulseSensorStream,
  subscribeCrowdPulseSensor,
  type CrowdPulseSensorStatus,
} from './crowd-pulse-sensor';
import { WidgetFrame } from './widget-frame';

const STEWARD_METRICS_HOLD_MS = 120_000;
const SENSOR_EMIT_INTERVAL_MS = 300;

const normalizeStatus = (value: unknown): CrowdPulseState['status'] | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'idle' || normalized === 'counting' || normalized === 'locked' || normalized === 'q_and_a') {
    return normalized;
  }
  if (normalized === 'q&a' || normalized === 'qa' || normalized === 'q and a') {
    return 'q_and_a';
  }
  return undefined;
};

const formatStatusLabel = (status: CrowdPulseState['status']) =>
  status === 'q_and_a' ? 'Q&A' : status.toUpperCase();

const normalizeQuestionText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const seedQuestionQueue = (
  activeQuestion: string | undefined,
  questions: CrowdPulseState['questions'],
): CrowdPulseState['questions'] => {
  const normalizedActive = normalizeQuestionText(activeQuestion);
  if (!normalizedActive) return questions;
  const exists = questions.some(
    (question) => question.text.trim().toLowerCase() === normalizedActive.toLowerCase(),
  );
  if (exists) return questions;
  return [
    {
      id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text: normalizedActive,
      votes: 0,
      status: 'open',
    },
    ...questions,
  ].slice(0, 20);
};

export default function CrowdPulseWidget(props: CrowdPulseWidgetProps) {
  const {
    __custom_message_id,
    messageId: propMessageId,
    contextKey,
    className,
    ...initial
  } = props;

  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `crowd-pulse-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const [state, setState] = useState<CrowdPulseState>(() => ({
    ...(() => {
      const nextActiveQuestion = normalizeQuestionText(initial.activeQuestion) ?? undefined;
      const nextQuestions = seedQuestionQueue(nextActiveQuestion, initial.questions ?? []);
      return {
        activeQuestion: nextActiveQuestion,
        questions: nextQuestions,
      };
    })(),
    title: initial.title ?? 'Crowd Pulse',
    prompt: initial.prompt,
    status: normalizeStatus(initial.status) ?? 'idle',
    handCount: initial.handCount ?? 0,
    peakCount: initial.peakCount ?? 0,
    confidence: initial.confidence ?? 0,
    noiseLevel: initial.noiseLevel ?? 0,
    scoreboard: initial.scoreboard ?? [],
    followUps: initial.followUps ?? [],
    version: typeof initial.version === 'number' ? initial.version : 1,
    lastUpdated: initial.lastUpdated,
    demoMode: initial.demoMode ?? false,
    sensorEnabled: initial.sensorEnabled ?? true,
    showPreview: initial.showPreview ?? true,
    className,
  }));

  const [sensorStatus, setSensorStatus] = useState<CrowdPulseSensorStatus>('idle');
  const [sensorDetail, setSensorDetail] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastEmitRef = useRef<number>(0);
  const peakRef = useRef<number>(state.peakCount ?? 0);
  const stewardMetricsHoldUntilRef = useRef<number>(0);
  const sensorUnsubscribeRef = useRef<(() => void) | null>(null);

  const applyPatch = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => {
      const next: CrowdPulseState = { ...prev };
      const hasExplicitMetricsPatch =
        typeof patch.handCount === 'number' ||
        typeof patch.peakCount === 'number' ||
        typeof patch.confidence === 'number' ||
        typeof patch.noiseLevel === 'number';

      if (typeof patch.title === 'string') next.title = patch.title;
      if (typeof patch.prompt === 'string') next.prompt = patch.prompt;
      const normalizedStatus = normalizeStatus(patch.status);
      if (normalizedStatus) {
        next.status = normalizedStatus;
      }
      if (typeof patch.handCount === 'number') next.handCount = patch.handCount;
      if (typeof patch.peakCount === 'number') next.peakCount = patch.peakCount;
      if (typeof patch.confidence === 'number') next.confidence = patch.confidence;
      if (typeof patch.noiseLevel === 'number') next.noiseLevel = patch.noiseLevel;
      const hasActiveQuestionPatch = Object.prototype.hasOwnProperty.call(patch, 'activeQuestion');
      let nextQuestionText: string | null = null;
      if (hasActiveQuestionPatch) {
        if (typeof patch.activeQuestion === 'string') {
          nextQuestionText = normalizeQuestionText(patch.activeQuestion);
          if (nextQuestionText === null) {
            next.activeQuestion = undefined;
          } else {
            next.activeQuestion = nextQuestionText;
          }
        } else if (patch.activeQuestion === null) {
          next.activeQuestion = undefined;
        }
      }
      if (Array.isArray(patch.questions)) next.questions = patch.questions as CrowdPulseState['questions'];
      if (Array.isArray(patch.scoreboard)) next.scoreboard = patch.scoreboard as CrowdPulseState['scoreboard'];
      if (Array.isArray(patch.followUps)) next.followUps = patch.followUps as string[];
      if (typeof patch.lastUpdated === 'number') next.lastUpdated = patch.lastUpdated;
      if (typeof patch.version === 'number') next.version = patch.version;
      if (typeof patch.demoMode === 'boolean') next.demoMode = patch.demoMode;
      if (typeof patch.sensorEnabled === 'boolean') next.sensorEnabled = patch.sensorEnabled;
      if (hasExplicitMetricsPatch) {
        // Prevent local camera telemetry from immediately clobbering explicit steward updates.
        stewardMetricsHoldUntilRef.current = Date.now() + STEWARD_METRICS_HOLD_MS;
      }
      if (typeof patch.showPreview === 'boolean') next.showPreview = patch.showPreview;

      const explicitQuestionsPatch = Array.isArray(patch.questions)
        ? (patch.questions as CrowdPulseState['questions'])
        : undefined;
      const hasExplicitQuestionsPatch = Array.isArray(explicitQuestionsPatch);
      const shouldAutoAppendQuestion =
        !hasExplicitQuestionsPatch ||
        (hasExplicitQuestionsPatch && explicitQuestionsPatch.length === 0);
      if (shouldAutoAppendQuestion && hasActiveQuestionPatch && nextQuestionText) {
        const exists = next.questions.some((question) => question.text.trim().toLowerCase() === nextQuestionText.toLowerCase());
        if (!exists) {
          next.questions = [
            {
              id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              text: nextQuestionText,
              votes: 0,
              status: 'open',
            },
            ...next.questions,
          ].slice(0, 20);
        }
      }

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
      version: state.version,
      lastUpdated: state.lastUpdated,
      demoMode: state.demoMode,
      sensorEnabled: state.sensorEnabled,
      showPreview: state.showPreview,
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

  useEffect(() => {
    if (!state.sensorEnabled) {
      if (sensorUnsubscribeRef.current) {
        sensorUnsubscribeRef.current();
        sensorUnsubscribeRef.current = null;
      }
      setSensorStatus('idle');
      setSensorDetail('Camera paused');
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    let mounted = true;
    lastEmitRef.current = 0;

    if (sensorUnsubscribeRef.current) {
      sensorUnsubscribeRef.current();
      sensorUnsubscribeRef.current = null;
    }

    sensorUnsubscribeRef.current = subscribeCrowdPulseSensor(
      (sample) => {
        if (!mounted) return;
        if (sample.timestamp - lastEmitRef.current < SENSOR_EMIT_INTERVAL_MS) {
          return;
        }
        if (Date.now() < stewardMetricsHoldUntilRef.current) {
          return;
        }
        lastEmitRef.current = sample.timestamp;
        if (sample.handCount > peakRef.current) {
          peakRef.current = sample.handCount;
        }

        setState((prev) => {
          const next: CrowdPulseState = { ...prev };
          next.handCount = sample.handCount;
          next.peakCount = Math.max(prev.peakCount, peakRef.current);
          next.confidence = sample.confidence;
          next.noiseLevel = sample.noiseLevel;
          next.lastUpdated = sample.timestamp;
          next.version = (prev.version ?? 0) + 1;
          if (prev.status === 'idle' && sample.handCount > 0) {
            next.status = 'counting';
          }
          return next;
        });
      },
      (status, detail) => {
        if (!mounted) return;
        setSensorStatus(status);
        setSensorDetail(detail);
        const stream = getCrowdPulseSensorStream();
        if (status === 'ready' && stream && videoRef.current) {
          if (videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream;
          }
          void videoRef.current.play().catch(() => {});
          return;
        }
        if (status !== 'ready' && videoRef.current) {
          videoRef.current.srcObject = null;
        }
      },
    );

    return () => {
      mounted = false;
      if (sensorUnsubscribeRef.current) {
        sensorUnsubscribeRef.current();
        sensorUnsubscribeRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [state.sensorEnabled]);

  useEffect(() => {
    if (!state.showPreview || sensorStatus !== 'ready' || !videoRef.current) {
      return;
    }
    const stream = getCrowdPulseSensorStream();
    if (!stream) {
      return;
    }
    if (videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
    void videoRef.current.play().catch(() => {});
  }, [sensorStatus, state.showPreview]);

  const updatedLabel = state.lastUpdated
    ? new Date(state.lastUpdated).toLocaleTimeString()
    : 'Idle';
  const sensorLabel =
    sensorStatus === 'ready'
      ? 'Camera live'
      : sensorStatus === 'loading'
        ? 'Camera starting...'
        : sensorStatus === 'blocked'
          ? 'Camera blocked'
          : sensorStatus === 'unsupported'
            ? 'Camera unavailable'
            : sensorStatus === 'error'
              ? sensorDetail || 'Camera error'
              : sensorDetail || undefined;

  return (
    <WidgetFrame
      title={state.title}
      subtitle={state.prompt}
      meta={state.lastUpdated ? `Updated ${updatedLabel}` : undefined}
      actions={
        <span
          className={cn(
            'rounded-full px-2 py-1 text-xs font-semibold border',
            state.status === 'locked'
              ? 'bg-success-surface text-success border-success-surface'
              : state.status === 'q_and_a'
                ? 'bg-success-surface text-success border-success-surface'
              : state.status === 'counting'
                ? 'bg-info-surface text-info border-info-surface'
                : 'bg-surface-secondary text-secondary border-default',
          )}
        >
          {formatStatusLabel(state.status)}
        </span>
      }
      className={className}
      bodyClassName="grid gap-4"
    >
        {state.showPreview && (
          <div className="relative overflow-hidden rounded-xl border border-default bg-surface-secondary">
            <video
              ref={videoRef}
              className="h-44 w-full bg-black object-cover"
              playsInline
              muted
              autoPlay
            />
            {sensorLabel && (
              <div className="absolute bottom-2 left-2 rounded-full bg-surface/90 border border-default px-2 py-1 text-[10px] text-secondary">
                {sensorLabel}
              </div>
            )}
          </div>
        )}
        <CrowdPulseStats
          demoMode={state.demoMode}
          handCount={state.handCount}
          peakCount={state.peakCount}
          confidence={state.confidence}
          noiseLevel={state.noiseLevel}
          sensorLabel={sensorLabel}
        />

        <CrowdPulseActiveQuestion activeQuestion={state.activeQuestion} />

        <div className="grid gap-3 lg:grid-cols-2">
          <CrowdPulseQuestions questions={state.questions} />
          <CrowdPulseScoreboard scoreboard={state.scoreboard} />
        </div>

        <CrowdPulseFollowUps followUps={state.followUps} />
    </WidgetFrame>
  );
}

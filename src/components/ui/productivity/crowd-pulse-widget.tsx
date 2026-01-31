'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  computeCrowdMetrics,
  type HandLandmark,
} from './crowd-pulse-hand-utils';

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
    sensorEnabled: initial.sensorEnabled ?? true,
    showPreview: initial.showPreview ?? true,
    className,
  }));

  const [sensorStatus, setSensorStatus] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error' | 'unsupported'>('idle');
  const [sensorDetail, setSensorDetail] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectRef = useRef<number>(0);
  const lastEmitRef = useRef<number>(0);
  const peakRef = useRef<number>(state.peakCount ?? 0);

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
      if (typeof patch.sensorEnabled === 'boolean') next.sensorEnabled = patch.sensorEnabled;
      if (typeof patch.showPreview === 'boolean') next.showPreview = patch.showPreview;
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
      setSensorStatus('idle');
      setSensorDetail('Camera paused');
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSensorStatus('unsupported');
      setSensorDetail('Camera unavailable');
      return;
    }

    let mounted = true;
    let handLandmarker: any = null;
    let lastVideoTime = -1;

    const initSensor = async () => {
      try {
        setSensorStatus('loading');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (!mounted) return;
        streamRef.current = stream;

        let video = videoRef.current;
        if (!video) {
          video = document.createElement('video');
          video.playsInline = true;
          video.muted = true;
          video.autoplay = true;
          videoRef.current = video;
        }
        video.srcObject = stream;
        await video.play();

        const visionModule = await import('@mediapipe/tasks-vision');
        const fileset = await visionModule.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm',
        );
        handLandmarker = await visionModule.HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });

        if (!mounted) return;
        setSensorStatus('ready');
        setSensorDetail('Camera live');

        const loop = () => {
          if (!mounted || !video || !handLandmarker) return;
          const now = performance.now();
          if (now - lastDetectRef.current < 100) {
            animationRef.current = requestAnimationFrame(loop);
            return;
          }
          lastDetectRef.current = now;

          if (video.currentTime === lastVideoTime) {
            animationRef.current = requestAnimationFrame(loop);
            return;
          }
          lastVideoTime = video.currentTime;

          let result: any;
          try {
            result = handLandmarker.detectForVideo(video, now);
          } catch (err) {
            setSensorStatus('error');
            setSensorDetail(err instanceof Error ? err.message : 'Sensor error');
            return;
          }

          const landmarks = Array.isArray(result?.landmarks) ? (result.landmarks as HandLandmark[][]) : [];
          const handedness = Array.isArray(result?.handednesses)
            ? result.handednesses
            : Array.isArray(result?.handedness)
              ? result.handedness
              : undefined;

          const metrics = computeCrowdMetrics(landmarks, handedness);
          if (metrics.handCount > peakRef.current) peakRef.current = metrics.handCount;

          if (now - lastEmitRef.current > 120) {
            lastEmitRef.current = now;
            setState((prev) => {
              const next: CrowdPulseState = { ...prev };
              next.handCount = metrics.handCount;
              next.peakCount = Math.max(prev.peakCount, peakRef.current);
              next.confidence = metrics.confidence;
              next.noiseLevel = metrics.noiseLevel;
              next.lastUpdated = Date.now();
              if (prev.status === 'idle' && metrics.handCount > 0) {
                next.status = 'counting';
              }
              return next;
            });
          }

          animationRef.current = requestAnimationFrame(loop);
        };

        animationRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (!mounted) return;
        if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'NotAllowedError') {
          setSensorStatus('blocked');
          setSensorDetail('Camera blocked');
        } else {
          setSensorStatus('error');
          setSensorDetail(err instanceof Error ? err.message : 'Sensor error');
        }
      }
    };

    initSensor();

    return () => {
      mounted = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (handLandmarker?.close) {
        try {
          handLandmarker.close();
        } catch { }
      }
    };
  }, [state.sensorEnabled]);

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
        {state.showPreview && (
          <div className="relative overflow-hidden rounded-xl border border-slate-800/50 bg-slate-900/70">
            <video
              ref={videoRef}
              className="h-44 w-full bg-black object-cover"
              playsInline
              muted
              autoPlay
            />
            {sensorLabel && (
              <div className="absolute bottom-2 left-2 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] text-slate-200">
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
      </div>
    </div>
  );
}

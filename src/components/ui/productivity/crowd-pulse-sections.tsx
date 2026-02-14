'use client';

import { cn } from '@/lib/utils';
import type { CrowdPulseState, CrowdQuestion, CrowdScore } from './crowd-pulse-schema';

const statusStyles: Record<CrowdPulseState['status'], string> = {
  idle: 'bg-surface-secondary text-secondary border border-default',
  counting: 'bg-info-surface text-info border border-info-surface',
  locked: 'bg-success-surface text-success border border-success-surface',
  q_and_a: 'bg-success-surface text-success border border-success-surface',
};

const formatStatusLabel = (status: CrowdPulseState['status']) =>
  status === 'q_and_a' ? 'Q&A' : status.toUpperCase();

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

type HeaderProps = {
  title: string;
  prompt?: string;
  status: CrowdPulseState['status'];
  updatedLabel: string;
};

export function CrowdPulseHeader({ title, prompt, status, updatedLabel }: HeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-default px-4 py-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-tertiary">
          Crowd Pulse
        </div>
        <div className="text-lg font-semibold text-primary">{title}</div>
        {prompt && <div className="text-xs text-secondary">{prompt}</div>}
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', statusStyles[status])}>
          {formatStatusLabel(status)}
        </span>
        <span className="text-[10px] text-tertiary">Updated {updatedLabel}</span>
      </div>
    </div>
  );
}

type StatsProps = {
  demoMode: boolean;
  handCount: number;
  peakCount: number;
  confidence: number;
  noiseLevel: number;
  sensorLabel?: string;
};

export function CrowdPulseStats({
  demoMode,
  handCount,
  peakCount,
  confidence,
  noiseLevel,
  sensorLabel,
}: StatsProps) {
  const hasConfidence = Number.isFinite(confidence);
  const hasNoise = Number.isFinite(noiseLevel);

  return (
    <>
      {sensorLabel && (
        <div className="rounded-xl border border-default bg-surface-secondary px-3 py-2 text-xs text-secondary">
          {sensorLabel}
        </div>
      )}
      {demoMode && (
        <div className="rounded-xl border border-info-surface bg-info-surface px-3 py-2 text-xs text-info">
          Simulated crowd feed (demo mode)
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-default bg-surface-secondary p-3">
          <div className="text-xs text-tertiary">Hands Up</div>
          <div className="mt-1 text-2xl font-semibold text-primary">{handCount}</div>
        </div>
        <div className="rounded-xl border border-default bg-surface-secondary p-3">
          <div className="text-xs text-tertiary">Peak</div>
          <div className="mt-1 text-2xl font-semibold text-primary">{peakCount}</div>
        </div>
        <div className="rounded-xl border border-default bg-surface-secondary p-3">
          <div className="text-xs text-tertiary">Confidence</div>
          <div className="mt-1 text-lg font-semibold text-primary">
            {hasConfidence ? formatPercent(confidence) : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-default bg-surface-secondary p-3">
          <div className="text-xs text-tertiary">Noise Level</div>
          <div className="mt-1 text-lg font-semibold text-primary">
            {hasNoise ? formatPercent(noiseLevel) : '—'}
          </div>
        </div>
      </div>
    </>
  );
}

export function CrowdPulseActiveQuestion({ activeQuestion }: { activeQuestion?: string }) {
  if (!activeQuestion) return null;
  return (
    <div className="rounded-xl border border-info-surface bg-info-surface px-3 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-info">Live Question</div>
      <div className="mt-1 text-sm text-primary">{activeQuestion}</div>
    </div>
  );
}

export function CrowdPulseQuestions({ questions }: { questions: CrowdQuestion[] }) {
  return (
    <div className="rounded-xl border border-default bg-surface-secondary p-3">
      <div className="text-xs uppercase tracking-[0.2em] text-tertiary">Question Queue</div>
      <div className="mt-3 space-y-2 text-sm">
        {questions.length === 0 && (
          <div className="text-xs text-tertiary">No questions captured yet.</div>
        )}
        {questions.slice(0, 5).map((question) => (
          <div key={question.id} className="rounded-lg border border-default bg-surface px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm text-primary">{question.text}</span>
              <span className="text-xs text-secondary">{question.votes ?? 0}↑</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-tertiary">
              {question.status && <span>{question.status}</span>}
              {question.speaker && <span>· {question.speaker}</span>}
              {question.tags?.map((tag) => (
                <span key={tag}>· {tag}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CrowdPulseScoreboard({ scoreboard }: { scoreboard: CrowdScore[] }) {
  return (
    <div className="rounded-xl border border-default bg-surface-secondary p-3">
      <div className="text-xs uppercase tracking-[0.2em] text-tertiary">Scoreboard</div>
      <div className="mt-3 space-y-2 text-sm">
        {scoreboard.length === 0 && (
          <div className="text-xs text-tertiary">No scores yet.</div>
        )}
        {scoreboard.map((score) => (
          <div key={score.label} className="flex items-center justify-between rounded-lg border border-default bg-surface px-3 py-2">
            <span className="text-primary">{score.label}</span>
            <span className="text-secondary">
              {score.score}
              {typeof score.delta === 'number' && (
                <span className={cn('ml-2 text-xs', score.delta >= 0 ? 'text-success' : 'text-danger')}>
                  {score.delta >= 0 ? `+${score.delta}` : score.delta}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CrowdPulseFollowUps({ followUps }: { followUps: string[] }) {
  return (
    <div className="rounded-xl border border-default bg-surface-secondary p-3">
      <div className="text-xs uppercase tracking-[0.2em] text-tertiary">Suggested Follow-Ups</div>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-secondary">
        {followUps.length === 0 && (
          <li className="text-xs text-tertiary">No follow-ups generated yet.</li>
        )}
        {followUps.map((item, idx) => (
          <li key={`${item}-${idx}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

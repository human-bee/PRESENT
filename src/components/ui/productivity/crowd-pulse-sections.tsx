'use client';

import { cn } from '@/lib/utils';
import type { CrowdPulseState, CrowdQuestion, CrowdScore } from './crowd-pulse-schema';

const statusStyles: Record<CrowdPulseState['status'], string> = {
  idle: 'bg-slate-800/70 text-slate-200',
  counting: 'bg-cyan-500/20 text-cyan-200',
  locked: 'bg-emerald-500/20 text-emerald-200',
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

type HeaderProps = {
  title: string;
  prompt?: string;
  status: CrowdPulseState['status'];
  updatedLabel: string;
};

export function CrowdPulseHeader({ title, prompt, status, updatedLabel }: HeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/60 px-4 py-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/80">
          Crowd Pulse
        </div>
        <div className="text-lg font-semibold">{title}</div>
        {prompt && <div className="text-xs text-slate-300">{prompt}</div>}
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', statusStyles[status])}>
          {status.toUpperCase()}
        </span>
        <span className="text-[10px] text-slate-400">Updated {updatedLabel}</span>
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
};

export function CrowdPulseStats({
  demoMode,
  handCount,
  peakCount,
  confidence,
  noiseLevel,
}: StatsProps) {
  const hasConfidence = Number.isFinite(confidence);
  const hasNoise = Number.isFinite(noiseLevel);

  return (
    <>
      {demoMode && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
          Simulated crowd feed (demo mode)
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">Hands Up</div>
          <div className="mt-1 text-2xl font-semibold">{handCount}</div>
        </div>
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">Peak</div>
          <div className="mt-1 text-2xl font-semibold">{peakCount}</div>
        </div>
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">Confidence</div>
          <div className="mt-1 text-lg font-semibold">
            {hasConfidence ? formatPercent(confidence) : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">Noise Level</div>
          <div className="mt-1 text-lg font-semibold">
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
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">Live Question</div>
      <div className="mt-1 text-sm text-white">{activeQuestion}</div>
    </div>
  );
}

export function CrowdPulseQuestions({ questions }: { questions: CrowdQuestion[] }) {
  return (
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Question Queue</div>
      <div className="mt-3 space-y-2 text-sm">
        {questions.length === 0 && (
          <div className="text-xs text-slate-400">No questions captured yet.</div>
        )}
        {questions.slice(0, 5).map((question) => (
          <div key={question.id} className="rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm">{question.text}</span>
              <span className="text-xs text-cyan-200">{question.votes ?? 0}↑</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-400">
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
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Scoreboard</div>
      <div className="mt-3 space-y-2 text-sm">
        {scoreboard.length === 0 && (
          <div className="text-xs text-slate-400">No scores yet.</div>
        )}
        {scoreboard.map((score) => (
          <div key={score.label} className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-950/60 px-3 py-2">
            <span>{score.label}</span>
            <span className="text-cyan-200">
              {score.score}
              {typeof score.delta === 'number' && (
                <span className="ml-2 text-xs text-emerald-300">
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
    <div className="rounded-xl border border-slate-800/50 bg-slate-900/70 p-3">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Suggested Follow-Ups</div>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-slate-200">
        {followUps.length === 0 && (
          <li className="text-xs text-slate-400">No follow-ups generated yet.</li>
        )}
        {followUps.map((item, idx) => (
          <li key={`${item}-${idx}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

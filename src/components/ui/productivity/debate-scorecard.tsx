'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Award,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileOutput,
  FileText,
  Filter,
  Flame,
  Gavel,
  GaugeCircle,
  History,
  Info,
  Layers3,
  Link2,
  Loader2,
  Map as MapIcon,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldMinus,
  ShieldQuestion,
  ShieldX,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';
import { ComponentRegistry, useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import {
  debateScorecardStateSchema as debateScorecardSchema,
  verdictEnum,
  impactEnum,
  claimStatusEnum,
  debateAchievementEnum,
  type Claim,
  type FactCheckNote,
  type MapNode,
  type MapEdge,
  type EvidenceRef,
  type DebateTimelineEvent as TimelineEvent,
  type DebatePlayer,
  type AchievementAward,
  type DebateScorecardState,
  type Verdict,
  type Impact,
  type ClaimStatus,
  type DebateAchievementKey,
} from '@/lib/agents/debate-scorecard-schema';

export type DebateScorecardProps = DebateScorecardState;
export const debateScoreCardSchema = debateScorecardSchema;

type DebateScorecardInjectedProps = DebateScorecardProps & {
  state?: Record<string, unknown>;
  updateState?: (patch: Record<string, unknown> | ((prev: any) => any)) => void;
};

const verdictConfig: Record<
  Verdict,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  ACCURATE: {
    label: 'Accurate',
    className: 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/30',
    icon: CheckCircle2,
  },
  PARTIALLY_TRUE: {
    label: 'Partially True',
    className: 'bg-amber-500/15 text-amber-300 border border-amber-400/30',
    icon: ShieldMinus,
  },
  UNSUPPORTED: {
    label: 'Unsupported',
    className: 'bg-orange-500/15 text-orange-300 border border-orange-400/30',
    icon: AlertTriangle,
  },
  FALSE: {
    label: 'False',
    className: 'bg-red-600/15 text-red-400 border border-red-500/30',
    icon: ShieldX,
  },
};

const impactConfig: Record<Impact, { label: string; className: string }> = {
  KEY_VOTER: {
    label: 'Key Voter',
    className: 'bg-blue-500/10 text-blue-300 border border-blue-400/40',
  },
  MAJOR: {
    label: 'Major',
    className: 'bg-sky-500/10 text-sky-300 border border-sky-400/40',
  },
  MINOR: {
    label: 'Minor',
    className: 'bg-slate-500/10 text-slate-300 border border-slate-400/40',
  },
  CREDIBILITY_HIT: {
    label: 'Credibility Hit',
    className: 'bg-purple-500/10 text-purple-300 border border-purple-400/40',
  },
  DROPPED: {
    label: 'Dropped',
    className: 'bg-neutral-500/10 text-neutral-300 border border-neutral-400/40',
  },
};

const claimStatusConfig: Record<
  ClaimStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  UNTESTED: {
    label: 'Untested',
    className: 'bg-slate-500/15 text-slate-200 border border-slate-500/40',
    icon: ShieldQuestion,
  },
  CHECKING: {
    label: 'Checking',
    className: 'bg-amber-500/15 text-amber-200 border border-amber-500/40',
    icon: Loader2,
  },
  VERIFIED: {
    label: 'Verified',
    className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40',
    icon: ShieldCheck,
  },
  REFUTED: {
    label: 'Refuted',
    className: 'bg-rose-600/15 text-rose-200 border border-rose-500/40',
    icon: ShieldX,
  },
};

const achievementConfig: Record<
  DebateAchievementKey,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  firstBlood: {
    label: 'First Blood',
    description: 'First verified claim of the debate.',
    icon: Target,
    className: 'bg-rose-500/15 text-rose-200 border border-rose-500/40',
  },
  evidenceKing: {
    label: 'Evidence King',
    description: 'Dominated with trustworthy sources.',
    icon: BookOpen,
    className: 'bg-sky-500/15 text-sky-200 border border-sky-500/40',
  },
  streakMaster: {
    label: 'On Fire',
    description: 'Verified three claims in a row.',
    icon: Flame,
    className: 'bg-amber-500/15 text-amber-200 border border-amber-500/40',
  },
  counterPunch: {
    label: 'Counter Punch',
    description: 'Refuted an opponent claim decisively.',
    icon: ArrowRightLeft,
    className: 'bg-purple-500/15 text-purple-200 border border-purple-500/40',
  },
  tactician: {
    label: 'Tactician',
    description: 'Perfect logical structure across the round.',
    icon: Brain,
    className: 'bg-emerald-600/15 text-emerald-200 border border-emerald-500/40',
  },
};

const speechLabels: Record<string, string> = {
  AFF: 'Aff',
  NEG: 'Neg',
  '1AC': '1AC – Aff Constructive',
  '1NC': '1NC – Neg Constructive',
  '2AC': '2AC – Aff Constructive',
  '2NC': '2NC – Neg Constructive',
  '1AR': '1AR – Aff Rebuttal',
  '1NR': '1NR – Neg Rebuttal',
  '2AR': '2AR – Aff Rebuttal',
  '2NR': '2NR – Neg Rebuttal',
};

const timelineMeta: Record<
  TimelineEvent['type'],
  { icon: React.ComponentType<{ className?: string }>; className: string; label: string }
> = {
  argument: { icon: FileText, className: 'text-sky-300', label: 'Argument' },
  rebuttal: { icon: ArrowRightLeft, className: 'text-purple-300', label: 'Rebuttal' },
  fact_check: { icon: ShieldCheck, className: 'text-emerald-300', label: 'Fact Check' },
  score_change: { icon: Trophy, className: 'text-amber-300', label: 'Score Change' },
  moderation: { icon: Info, className: 'text-slate-300', label: 'Moderation' },
  achievement: { icon: Sparkles, className: 'text-pink-300', label: 'Achievement' },
};

const coerceFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const statesDiffer = (prev: DebateScorecardState, next: DebateScorecardState): boolean => {
  if (prev === next) return false;
  try {
    return JSON.stringify(prev) !== JSON.stringify(next);
  } catch {
    return true;
  }
};

const shouldPromoteScorecard = (
  current: DebateScorecardState,
  candidate: DebateScorecardState,
): boolean => {
  if (candidate.componentId && candidate.componentId !== current.componentId) {
    return true;
  }

  const nextVersion = coerceFiniteNumber(candidate.version);
  const currentVersion = coerceFiniteNumber(current.version);
  if (nextVersion != null) {
    if (currentVersion == null || nextVersion > currentVersion) {
      return true;
    }
    if (nextVersion < currentVersion) {
      return false;
    }
  }

  const nextTimestamp = coerceFiniteNumber(candidate.lastUpdated);
  const currentTimestamp = coerceFiniteNumber(current.lastUpdated);
  if (nextTimestamp != null) {
    if (currentTimestamp == null || nextTimestamp > currentTimestamp) {
      return true;
    }
    if (nextTimestamp < currentTimestamp) {
      return false;
    }
  }

  return statesDiffer(current, candidate);
};

function formatDate(value?: string | number) {
  if (value === undefined || value === null) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusBadge(status: ClaimStatus) {
  const cfg = claimStatusConfig[status];
  const Icon = cfg.icon;
  const isChecking = status === 'CHECKING';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
        cfg.className,
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', isChecking && 'animate-spin')} />
      {cfg.label}
    </span>
  );
}

function verdictBadge(verdict?: Verdict) {
  if (!verdict) return null;
  const cfg = verdictConfig[verdict];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
        cfg.className,
      )}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function impactBadge(impact?: Impact) {
  if (!impact) return null;
  const cfg = impactConfig[impact];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium',
        cfg.className,
      )}
    >
      <Sparkles className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function AchievementBadge({ award }: { award: AchievementAward }) {
  const cfg = achievementConfig[award.key];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium',
        cfg.className,
      )}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function StrengthMeter({ strength, confidence }: { strength: Claim['strength']; confidence: number }) {
  const metrics = [
    { key: 'logos', label: 'Logic', value: strength.logos, color: 'bg-sky-400' },
    { key: 'pathos', label: 'Emotion', value: strength.pathos, color: 'bg-pink-400' },
    { key: 'ethos', label: 'Credibility', value: strength.ethos, color: 'bg-indigo-400' },
  ];

  return (
    <div className="space-y-1.5">
      {metrics.map((metric) => (
        <div key={metric.key}>
          <div className="flex items-center justify-between text-[11px] text-white/40">
            <span>{metric.label}</span>
            <span>{Math.round(metric.value * 100)}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-300', metric.color)}
              style={{ width: `${Math.max(4, Math.round(metric.value * 100))}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1 text-[11px] text-white/40">
        <span>Confidence</span>
        <span>{Math.round(confidence * 100)}%</span>
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-white/40">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-1 h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', color)}
          style={{ width: `${Math.max(4, Math.round(value * 100))}%` }}
        />
      </div>
    </div>
  );
}

function SupportStats({ claim }: { claim: Claim }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/60">
      <span className="inline-flex items-center gap-1">
        <Link2 className="w-3.5 h-3.5 text-white/30" />
        {claim.evidenceCount} sources
      </span>
      <span className="inline-flex items-center gap-1">
        <Sparkles className="w-3.5 h-3.5 text-white/30" />
        {claim.upvotes} upvotes
      </span>
      <span className="inline-flex items-center gap-1">
        <Trophy className="w-3.5 h-3.5 text-white/30" />
        {claim.scoreDelta >= 0 ? '+' : ''}
        {claim.scoreDelta}
      </span>
    </div>
  );
}

type PlayerSummary = {
  player: DebatePlayer;
  verified: number;
  refuted: number;
  checking: number;
  untested: number;
  totalClaims: number;
};

function PlayerCard({ summary, opponentScore }: { summary: PlayerSummary; opponentScore: number }) {
  const diff = summary.player.score - opponentScore;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">{summary.player.side}</p>
          <h3 className="text-xl font-semibold text-white">{summary.player.label}</h3>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/40">Score</p>
          <p className="text-3xl font-bold text-white">{summary.player.score}</p>
          <p className={cn('text-xs', diff === 0 ? 'text-white/40' : diff > 0 ? 'text-emerald-300' : 'text-rose-300')}>
            {diff >= 0 ? '+' : ''}
            {diff}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-white/40">Verified</p>
          <p className="text-lg font-semibold text-emerald-300">{summary.verified}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-white/40">Refuted</p>
          <p className="text-lg font-semibold text-rose-300">{summary.refuted}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-white/40">Checking</p>
          <p className="text-lg font-semibold text-amber-300">{summary.checking}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-white/40">Untested</p>
          <p className="text-lg font-semibold text-white/70">{summary.untested}</p>
        </div>
      </div>

      <div className="space-y-3">
        <Meter label="Momentum" value={summary.player.momentum ?? 0} color="bg-emerald-400" />
        <Meter label="BS Meter" value={summary.player.bsMeter ?? 0} color="bg-rose-400" />
        <Meter label="Learning Score" value={summary.player.learningScore ?? 0} color="bg-sky-400" />
      </div>

      {summary.player.achievements.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/40 mb-2">Achievements</p>
          <div className="flex flex-wrap gap-2">
            {summary.player.achievements.map((award) => (
              <AchievementBadge key={award.id} award={award} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AchievementToast({
  award,
  onDismiss,
}: {
  award: AchievementAward;
  onDismiss: () => void;
}) {
  const cfg = achievementConfig[award.key];
  const Icon = cfg.icon;
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.08] px-5 py-4 shadow-lg flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-full', cfg.className)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            Achievement unlocked · {cfg.label}
            {award.side && <span className="text-xs text-white/50 uppercase">{award.side}</span>}
          </p>
          <p className="text-xs text-white/60">{cfg.description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-white/50 hover:text-white/80 transition"
      >
        Dismiss
      </button>
    </div>
  );
}

function ScoreSummaryCard({
  lastAction,
  pendingVerifications,
  players,
}: {
  lastAction?: string | null;
  pendingVerifications?: string[];
  players: DebatePlayer[];
}) {
  const unlocked = players.flatMap((player) =>
    (player.achievements || []).map((award) => ({
      ...award,
      playerLabel: player.label,
    })),
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">Debate Status</p>
        <p className="text-sm text-white/80 leading-relaxed">
          {lastAction && lastAction.trim()
            ? lastAction
            : 'Awaiting the next major update to the scorecard.'}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Pending verifications</p>
        {pendingVerifications && pendingVerifications.length > 0 ? (
          <ul className="text-xs text-white/70 space-y-1">
            {pendingVerifications.map((claimId) => (
              <li key={claimId} className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
                <span>{claimId}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-white/50">No outstanding fact checks.</p>
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Achievements unlocked</p>
        {unlocked.length > 0 ? (
          <ul className="text-xs text-white/70 space-y-1">
            {unlocked.map((award) => {
              const Icon = achievementConfig[award.key].icon;
              return (
                <li key={award.id} className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-pink-300" />
                  <span>
                    <strong>{award.label}</strong>
                    <span className="text-white/40"> · </span>
                    <span className="text-white/60">{award.playerLabel}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-white/50">No achievements yet—keep the arguments flowing.</p>
        )}
      </div>
    </div>
  );
}

function MetricsStrip({
  metrics,
  show,
}: {
  metrics: DebateScorecardState['metrics'];
  show: boolean;
}) {
  if (!show) return null;
  return (
    <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/60">Round Score</p>
          <p className="text-2xl font-semibold text-white">{Math.round(metrics.roundScore * 100)}%</p>
        </div>
        <GaugeCircle className="w-8 h-8 text-emerald-400" />
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/60">Judge Lean</p>
          <p className="text-lg font-medium text-white">
            {metrics.judgeLean === 'NEUTRAL' ? 'Neutral' : metrics.judgeLean}
          </p>
        </div>
        <ArrowRightLeft className="w-8 h-8 text-sky-400" />
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/60">Evidence Quality</p>
          <p className="text-2xl font-semibold text-white">
            {Math.round(metrics.evidenceQuality * 100)}%
          </p>
        </div>
        <BarChart3 className="w-8 h-8 text-amber-400" />
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/60">Excitement</p>
          <p className="text-2xl font-semibold text-white">{Math.round(metrics.excitement * 100)}%</p>
        </div>
        <Sparkles className="w-8 h-8 text-pink-300" />
      </div>
    </div>
  );
}

function LedgerTable({
  claims,
  factCheckEnabled,
  playerColorBySide,
}: {
  claims: Claim[];
  factCheckEnabled: boolean;
  playerColorBySide: Map<'AFF' | 'NEG', string>;
}) {
  if (!claims.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/60 gap-2 border border-dashed border-white/10 rounded-xl">
        <ClipboardList className="w-10 h-10" />
        <p className="font-medium">No claims captured yet.</p>
        <p className="text-xs text-white/40">
          Record arguments with the voice agent or by typing in the transcript.
        </p>
      </div>
    );
  }

  const sorted = [...claims].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
      <table className="min-w-full text-sm text-white/80">
        <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/60">
          <tr>
            <th className="px-4 py-3 text-left">Claim</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Support</th>
            <th className="px-4 py-3 text-left">Impact</th>
            <th className="px-4 py-3 text-left">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sorted.map((claim) => {
            const color = playerColorBySide.get(claim.side) ?? 'var(--foreground)';
            return (
              <tr key={claim.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: `${color}1a`, color }}
                      >
                        {claim.id}
                      </span>
                      <span className="text-xs text-white/40">
                        {speechLabels[claim.speech] || claim.speech}
                      </span>
                    </div>
                    <p className="text-white/90">{claim.quote}</p>
                    {claim.evidenceInline && (
                      <p className="text-xs text-white/40 italic">Evidence: {claim.evidenceInline}</p>
                    )}
                    {factCheckEnabled && claim.factChecks.length > 0 && (
                      <ul className="flex flex-col gap-1 text-xs text-white/65 border-l border-white/10 pl-3 mt-2">
                        {claim.factChecks.map((note) => (
                          <li key={note.id} className="flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 mt-0.5 text-white/30" />
                            <span>{note.summary}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top space-y-2">
                  {statusBadge(claim.status)}
                  {verdictBadge(claim.verdict as Verdict)}
                </td>
                <td className="px-4 py-3 align-top space-y-3">
                  <StrengthMeter strength={claim.strength} confidence={claim.confidence ?? 0} />
                  <SupportStats claim={claim} />
                </td>
                <td className="px-4 py-3 align-top">
                  {impactBadge(claim.impact as Impact)}
                </td>
                <td className="px-4 py-3 align-top text-xs text-white/50">
                  {claim.updatedAt ? formatDate(claim.updatedAt) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MapView({ nodes, edges }: { nodes: MapNode[]; edges: MapEdge[] }) {
  if (!nodes.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/60 gap-2 border border-dashed border-white/10 rounded-xl">
        <MapIcon className="w-10 h-10" />
        <p className="font-medium">Argument map is empty.</p>
        <p className="text-xs text-white/40">Drag claims from the ledger to build the skeleton of the round.</p>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="space-y-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              'rounded-xl border px-4 py-3 backdrop-blur-sm flex flex-col gap-1 text-sm',
              node.type === 'MAIN'
                ? 'border-blue-400/40 bg-blue-500/10 text-blue-100'
                : node.type === 'REASON'
                  ? 'border-white/10 bg-white/5 text-white'
                  : node.type === 'OBJECTION'
                    ? 'border-orange-400/40 bg-orange-500/10 text-orange-100'
                    : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-white/60">
                {node.type === 'MAIN'
                  ? 'Main Claim'
                  : node.type === 'REASON'
                    ? 'Reason'
                    : node.type === 'OBJECTION'
                      ? 'Objection'
                      : 'Rebuttal'}
              </span>
              {node.claimId && <span className="text-xs text-white/50">Linked to {node.claimId}</span>}
            </div>
            <p className="text-sm font-medium text-white/90">{node.label}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-4 text-sm text-white/70 space-y-3">
        <h3 className="text-white font-medium flex items-center gap-2 text-sm">
          <Layers3 className="w-4 h-4" />
          Connections
        </h3>
        {edges.length === 0 ? (
          <p className="text-xs text-white/40">No edges yet. Connect claims to show clash and support.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {edges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              return (
                <li key={`${edge.from}-${edge.to}`} className="flex items-start gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-white/30 mt-[2px]" />
                  <span>
                    <strong>{from?.label || edge.from}</strong>
                    <span className="text-white/40"> ↦ </span>
                    <strong>{to?.label || edge.to}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 text-xs text-white/40 space-y-1">
          <p>Tip: Drag ledger rows into the map to surface clash quickly.</p>
          <p>Use objection nodes to flag logical weaknesses or missing warrants.</p>
        </div>
      </div>
    </div>
  );
}

function RFDView({
  summary,
  links,
  claims,
}: {
  summary: string;
  links: { id: string; claimId: string; excerpt: string }[];
  claims: Claim[];
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center gap-2 text-white">
        <Gavel className="w-4 h-4" />
        <h3 className="text-sm font-semibold">Reason for Decision</h3>
      </div>
      <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{summary}</p>
      {links.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-white/40">Linked Claims</p>
          <ul className="space-y-2 text-sm text-white/80">
            {links.map((link) => {
              const claim = claims.find((c) => c.id === link.claimId);
              return (
                <li key={link.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-xs uppercase text-white/40">{link.claimId}</p>
                  <p className="text-white/80">
                    {claim?.quote ? `“${claim.quote}”` : claim?.id || link.claimId}
                  </p>
                  <p className="mt-1 text-xs text-white/50">{link.excerpt}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function SourcesView({ sources }: { sources: EvidenceRef[] }) {
  if (!sources.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/60 gap-2 border border-dashed border-white/10 rounded-xl">
        <ExternalLink className="w-10 h-10" />
        <p className="font-medium">No sources collected yet.</p>
        <p className="text-xs text-white/40">Fact-check claims to build a shared bibliography.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sources.map((source) => (
        <div
          key={source.id}
          className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-white/80"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{source.title || 'Untitled source'}</p>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-300 hover:underline break-all"
                >
                  {source.url}
                </a>
              )}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-white/70">
              <Award className="w-3 h-3" />
              {source.credibility}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-white/50">
            <span className="inline-flex items-center gap-1">
              <BookOpen className="w-3 h-3" />
              {source.type}
            </span>
            {source.lastVerified && (
              <span className="inline-flex items-center gap-1">
                <History className="w-3 h-3" />
                Verified {formatDate(source.lastVerified)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({
  events,
  players,
}: {
  events: TimelineEvent[];
  players: DebatePlayer[];
}) {
  if (!events.length) return null;
  const playerColorBySide = new Map(players.map((player) => [player.side, player.color]));

  return (
    <div className="mt-8">
      <h3 className="text-white font-medium flex items-center gap-2 text-sm">
        <History className="w-4 h-4" />
        Timeline
      </h3>
      <ul className="mt-3 space-y-2 text-xs text-white/70">
        {events
          .slice()
          .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
          .map((event) => {
            const meta = timelineMeta[event.type] ?? timelineMeta.argument;
            const Icon = meta.icon;
            const accentColor = event.side ? playerColorBySide.get(event.side) : undefined;
            const label = meta.label;
            return (
              <li key={event.id} className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                <Icon
                  className={cn('w-4 h-4 mt-0.5', meta.className)}
                  style={accentColor ? { color: accentColor } : undefined}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-white/40">
                    <span>{label}</span>
                    <span>•</span>
                    <span>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {event.side && (
                      <span className="uppercase" style={{ color: accentColor ?? 'var(--foreground)' }}>
                        {event.side}
                      </span>
                    )}
                  </div>
                  <p className="text-white/80">{event.text}</p>
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

export function DebateScorecard(props: DebateScorecardProps) {
  const injectedProps = props as DebateScorecardInjectedProps;
  const injectedState = injectedProps.state;
  const updateState = injectedProps.updateState;

  const parsedFromProps = useMemo(() => debateScorecardSchema.parse(props), [props]);
  const parsedFromPropsRef = useRef(parsedFromProps);
  useEffect(() => {
    parsedFromPropsRef.current = parsedFromProps;
  }, [parsedFromProps]);

  const parsedFromShapeState = useMemo(() => {
    if (!injectedState || typeof injectedState !== 'object') return null;
    const injectedKeys = Object.keys(injectedState);
    if (injectedKeys.length === 0) return null;
    const meaningfulKeys = new Set([
      'topic',
      'players',
      'claims',
      'sources',
      'timeline',
      'metrics',
      'filters',
      'map',
      'rfd',
      'status',
      'version',
      'lastUpdated',
    ]);
    if (!injectedKeys.some((key) => meaningfulKeys.has(key))) return null;
    try {
      const componentIdFromProps =
        typeof (props as any)?.componentId === 'string' && (props as any).componentId.trim().length > 0
          ? (props as any).componentId.trim()
          : undefined;
      const candidate = debateScorecardSchema.parse({
        ...(injectedState as Record<string, unknown>),
        ...(componentIdFromProps ? { componentId: componentIdFromProps } : {}),
      });
      return candidate;
    } catch {
      return null;
    }
  }, [injectedState, props]);

  const initialScorecard = useMemo(() => {
    return parsedFromProps;
  }, [parsedFromProps]);

  const [scorecard, setScorecard] = useState(initialScorecard);
  const hydratedShapeStateRef = useRef(false);

  useEffect(() => {
    setScorecard((prev) => {
      let next = prev;
      if (shouldPromoteScorecard(next, parsedFromProps)) {
        next = parsedFromProps;
      }
      if (parsedFromShapeState && shouldPromoteScorecard(next, parsedFromShapeState)) {
        next = parsedFromShapeState;
      }
      return next;
    });
  }, [parsedFromProps, parsedFromShapeState]);

  useEffect(() => {
    if (hydratedShapeStateRef.current) return;
    if (!updateState) return;
    if (parsedFromShapeState) {
      hydratedShapeStateRef.current = true;
      return;
    }
    if (!injectedState || typeof injectedState !== 'object' || Object.keys(injectedState).length === 0) {
      hydratedShapeStateRef.current = true;
      try {
        updateState(parsedFromProps);
      } catch {
        /* noop */
      }
    }
  }, [injectedState, parsedFromProps, parsedFromShapeState, updateState]);

  const explicitMessageId =
    typeof (props as any).__custom_message_id === 'string' ? (props as any).__custom_message_id.trim() : '';

  const messageId = useMemo(() => {
    const stateId = scorecard.componentId?.trim() || parsedFromProps.componentId?.trim();
    return explicitMessageId || stateId || 'debate-scorecard';
  }, [explicitMessageId, parsedFromProps.componentId, scorecard.componentId]);

  const handleRegistryUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      const mergedProps = (patch as any)?.__mergedProps;
      const source = mergedProps ?? ComponentRegistry.get(messageId)?.props;
      console.log('[DebateScorecard] handleRegistryUpdate called', {
        messageId,
        hasMergedProps: Boolean(mergedProps),
        hasSource: Boolean(source),
        patchKeys: Object.keys(patch),
        sourceVersion: (source as any)?.version,
        sourceTopic: (source as any)?.topic,
      });
      if (!source) {
        console.log('[DebateScorecard] handleRegistryUpdate bailing - no source');
        return;
      }
      const candidate = debateScorecardSchema.parse(source);
      setScorecard((prev) => {
        const willUpdate = shouldPromoteScorecard(prev, candidate);
        console.log('[DebateScorecard] shouldPromoteScorecard', {
          willUpdate,
          prevVersion: prev.version,
          candidateVersion: candidate.version,
          prevTopic: prev.topic,
          candidateTopic: candidate.topic,
        });
        return willUpdate ? candidate : prev;
      });
    },
    [messageId],
  );

  useComponentRegistration(messageId, 'DebateScorecard', scorecard, 'canvas', handleRegistryUpdate);

  useEffect(() => {
    const incoming = parsedFromPropsRef.current;
    setScorecard((prev) => (shouldPromoteScorecard(prev, incoming) ? incoming : prev));
  }, [parsedFromProps.componentId, parsedFromProps.version, parsedFromProps.lastUpdated]);

  const [localFilters, setLocalFilters] = useState(scorecard.filters);
  const [factCheckToggle, setFactCheckToggle] = useState(scorecard.factCheckEnabled);

  useEffect(() => {
    setLocalFilters(scorecard.filters);
  }, [scorecard.filters]);

  useEffect(() => {
    setFactCheckToggle(scorecard.factCheckEnabled);
  }, [scorecard.factCheckEnabled]);

  const playerColorBySide = useMemo(() => {
    return new Map(scorecard.players.map((player) => [player.side, player.color || '#38bdf8']));
  }, [scorecard.players]);

  const playerSummaries = useMemo<PlayerSummary[]>(
    () =>
      scorecard.players.map((player) => {
        const claims = scorecard.claims.filter((claim) => claim.side === player.side);
        const verified = claims.filter((c) => c.status === 'VERIFIED').length;
        const refuted = claims.filter((c) => c.status === 'REFUTED').length;
        const checking = claims.filter((c) => c.status === 'CHECKING').length;
        const untested = claims.filter((c) => c.status === 'UNTESTED').length;
        return {
          player,
          verified,
          refuted,
          checking,
          untested,
          totalClaims: claims.length,
        };
      }),
    [scorecard.players, scorecard.claims],
  );

  const filteredClaims = useMemo(() => {
    const verdictFilter = new Set(localFilters.verdicts ?? []);
    const statusFilter = new Set(localFilters.statuses ?? []);
    const searchQuery = (localFilters.searchQuery || '').trim().toLowerCase();
    const speaker = localFilters.speaker || 'ALL';

    return scorecard.claims.filter((claim) => {
      if (speaker && speaker !== 'ALL') {
        if (speaker === 'AFF' && claim.side !== 'AFF') return false;
        if (speaker === 'NEG' && claim.side !== 'NEG') return false;
        if (
          ['1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR'].includes(speaker) &&
          claim.speech !== speaker
        ) {
          return false;
        }
      }

      if (verdictFilter.size > 0) {
        const claimVerdict = claim.verdict;
        if (!claimVerdict) {
          return false;
        }

        if (!verdictFilter.has(claimVerdict)) {
          return false;
        }
      }

      if (statusFilter.size > 0 && !statusFilter.has(claim.status)) {
        return false;
      }

      if (searchQuery) {
        const haystack = `${claim.quote} ${claim.summary ?? ''} ${claim.speaker ?? ''}`.toLowerCase();
        if (!haystack.includes(searchQuery)) {
          return false;
        }
      }

      return true;
    });
  }, [scorecard.claims, localFilters]);

  const [activeAchievement, setActiveAchievement] = useState<AchievementAward | null>(null);
  const latestAchievement =
    scorecard.achievementsQueue.length > 0
      ? scorecard.achievementsQueue[scorecard.achievementsQueue.length - 1]
      : null;

  useEffect(() => {
    if (!latestAchievement) return;
    if (activeAchievement && activeAchievement.id === latestAchievement.id) return;
    setActiveAchievement(latestAchievement);
    const timer = setTimeout(() => setActiveAchievement(null), 4500);
    return () => clearTimeout(timer);
  }, [latestAchievement?.id]);

  const statusOptions = claimStatusEnum.options as ClaimStatus[];

  const scoreline = playerSummaries.reduce(
    (acc, summary) => {
      acc.total += summary.player.score;
      acc.entries.push({ label: summary.player.label, score: summary.player.score });
      return acc;
    },
    { total: 0, entries: [] as { label: string; score: number }[] },
  );

  const lastAction = scorecard.status?.lastAction;
  const unlockedAchievements = scorecard.players.flatMap((player) =>
    (player.achievements || []).map((award) => ({
      ...award,
      playerLabel: player.label,
    })),
  );

  return (
    <div className="w-[960px] max-w-full">
      <div className="rounded-3xl border border-white/10 bg-slate-950/95 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)] shadow-xl text-white font-sans p-6 md:p-8 flex flex-col gap-6 backdrop-blur-sm">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.25em] text-white/40">Debate Analysis</p>
            <h2 className="text-2xl md:text-3xl font-semibold text-white">{scorecard.topic}</h2>
            <p className="text-sm text-white/50">{scorecard.round}</p>
            {lastAction && <p className="text-xs text-white/40 mt-2">Latest action: {lastAction}</p>}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-right">
            <p className="text-xs uppercase tracking-wide text-white/40">Scoreboard</p>
            <div className="flex items-center justify-end gap-3 text-2xl font-semibold text-white">
              {scoreline.entries.map((entry, index) => (
                <React.Fragment key={entry.label}>
                  <span>{entry.score}</span>
                  {index < scoreline.entries.length - 1 && <span className="text-white/30 text-xl">·</span>}
                </React.Fragment>
              ))}
            </div>
            <p className="text-xs text-white/40 mt-1">Total points exchanged: {scoreline.total}</p>
          </div>
        </header>

        {activeAchievement && (
          <AchievementToast award={activeAchievement} onDismiss={() => setActiveAchievement(null)} />
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="w-full space-y-4 lg:w-[320px] xl:w-[360px] flex-shrink-0">
            <div className="grid gap-4">
              {playerSummaries.map((summary, index) => (
                <PlayerCard
                  key={summary.player.id}
                  summary={summary}
                  opponentScore={playerSummaries[(index + 1) % playerSummaries.length]?.player.score ?? 0}
                />
              ))}
              <ScoreSummaryCard
                lastAction={lastAction}
                pendingVerifications={scorecard.status?.pendingVerifications}
                players={scorecard.players}
            />
          </div>

            <MetricsStrip metrics={scorecard.metrics} show={scorecard.showMetricsStrip} />

            <div className="grid gap-4 text-xs text-white/70">
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
                <p className="text-white font-medium flex items-center gap-2 text-sm">
                  <ShieldAlert className="w-4 h-4" /> Verdict legend
                </p>
                <div className="flex flex-wrap gap-2">
                  {verdictEnum.options.map((value) => {
                    const cfg = verdictConfig[value];
                    return (
                      <span key={value} className={cn('px-2 py-1 rounded-full text-[11px] font-medium', cfg.className)}>
                        {cfg.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
                <p className="text-white font-medium flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4" /> How to use
                </p>
                <ol className="list-decimal list-inside space-y-1 text-white/70">
                  <li>Record arguments verbatim with speaker and speech.</li>
                  <li>Verify claims, attach sources, and mark status.</li>
                  <li>Use the map to surface clash and supporting warrants.</li>
                  <li>Keep the RFD aligned with linked voters.</li>
                </ol>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
                <p className="text-white font-medium flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4" /> Achievements earned
                </p>
                {unlockedAchievements.length === 0 ? (
                  <p className="text-xs text-white/40">No achievements yet. Keep debating!</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {unlockedAchievements.map((award) => (
                      <AchievementBadge key={award.id} award={award} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <main className="flex-1 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                { key: 'ledger', label: 'Ledger', icon: FileText },
                { key: 'map', label: 'Map', icon: MapIcon },
                { key: 'rfd', label: 'Judge RFD', icon: Gavel },
                { key: 'sources', label: 'Sources', icon: BookOpen },
                { key: 'timeline', label: 'Timeline', icon: History },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = localFilters.activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() =>
                      setLocalFilters((prev) => ({
                        ...prev,
                        activeTab: tab.key as DebateScorecardState['filters']['activeTab'],
                      }))
                    }
                    className={cn(
                      'inline-flex items-center gap-2 px-3 py-2 rounded-full border transition',
                      active
                        ? 'border-white/40 bg-white/[0.12]'
                        : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
                  <Filter className="w-4 h-4" />
                  <select
                    className="bg-transparent text-white/80 text-xs focus:outline-none"
                    value={localFilters.speaker || 'ALL'}
                    onChange={(e) => setLocalFilters((prev) => ({ ...prev, speaker: e.target.value as any }))}
                  >
                    {['ALL', 'AFF', 'NEG', '1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR'].map((value) => (
                      <option key={value} value={value} className="text-black">
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 cursor-pointer">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-medium text-white/70">Fact-check notes</span>
                  <input
                    type="checkbox"
                    className="accent-emerald-400"
                    checked={factCheckToggle}
                    onChange={(e) => setFactCheckToggle(e.target.checked)}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {statusOptions.map((status) => {
                    const active = (localFilters.statuses || []).includes(status);
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() =>
                          setLocalFilters((prev) => {
                            const current = new Set(prev.statuses || []);
                            if (current.has(status)) {
                              current.delete(status);
                            } else {
                              current.add(status);
                            }
                            return { ...prev, statuses: Array.from(current) as ClaimStatus[] };
                          })
                        }
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full border px-2 py-1 transition',
                          active
                            ? 'border-white/40 bg-white/[0.12]'
                            : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]',
                        )}
                      >
                        {statusBadge(status)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    placeholder="Search claims, evidence, notes"
                    value={localFilters.searchQuery ?? ''}
                    onChange={(e) => setLocalFilters((prev) => ({ ...prev, searchQuery: e.target.value }))}
                    className="w-full rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-white/30"
                  />
                </div>
                <button className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] text-xs">
                  <FileOutput className="w-4 h-4" /> Export
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {localFilters.activeTab === 'timeline' ? (
                <Timeline events={scorecard.timeline} players={scorecard.players} />
              ) : (
                <>
                  {localFilters.activeTab === 'ledger' && (
                    <LedgerTable
                      claims={filteredClaims}
                      factCheckEnabled={factCheckToggle}
                      playerColorBySide={playerColorBySide as Map<'AFF' | 'NEG', string>}
                    />
                  )}
                  {localFilters.activeTab === 'map' && (
                    <MapView nodes={scorecard.map.nodes} edges={scorecard.map.edges} />
                  )}
                  {localFilters.activeTab === 'rfd' && (
                    <RFDView
                      summary={scorecard.rfd.summary}
                      links={scorecard.rfd.links}
                      claims={scorecard.claims}
                    />
                  )}
                  {localFilters.activeTab === 'sources' && <SourcesView sources={scorecard.sources} />}
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default DebateScorecard;

'use client';

import React, { useMemo, useCallback, useState } from 'react';
import { z } from 'zod';
import { useComponentRegistration } from '@/lib/component-registry';
import { LoadingWrapper, SkeletonPatterns } from '@/components/ui/loading-states';
import { LoadingState } from '@/lib/with-progressive-loading';
import { cn } from '@/lib/utils';
import {
  Trophy,
  Brain,
  BookOpen,
  Target,
  ShieldAlert,
  Sword,
  Timer,
  CheckCircle2,
  Info,
} from 'lucide-react';

// ---------------- Schema ----------------
export const debateScoreCardSchema = z.object({
  participant1: z.object({
    name: z.string().default('Ben'),
    avatar: z.string().optional(),
    color: z.string().default('#3B82F6'),
  }),
  participant2: z.object({
    name: z.string().default('Challenger'),
    avatar: z.string().optional(),
    color: z.string().default('#EF4444'),
  }),

  topic: z.string().default('Live Debate: Topic TBD').describe('What are they debating?'),
  timeLimit: z.number().default(30).describe('Minutes per round'),
  rounds: z.number().default(5).describe('Number of rounds'),

  visualStyle: z.enum(['boxing', 'gameboy', 'modern', 'minimalist']).default('boxing'),
  showFactChecking: z.boolean().default(true),
  showBSMeter: z.boolean().default(true),
  showTimeline: z.boolean().default(true),

  twitchMode: z.boolean().default(false),
  audiencePolling: z.boolean().default(false),
  moderatorMode: z.boolean().default(false),

  componentId: z.string().default('debate-scorecard'),
  __custom_message_id: z.string().optional(),
});

export type DebateScorecardProps = z.infer<typeof debateScoreCardSchema>;

// ---------------- Types ----------------
export type DebateScores = {
  argumentStrength: number;
  evidenceQuality: number;
  factualAccuracy: number;
  logicalConsistency: number;
  bsMeter: number;
  strawmanDetection: number;
  adHominemScore: number;
  humilityScore?: number; // legacy misspelling guard
  humility?: number; // guard
  humility_score?: number; // guard
  humilityScore?: number; // guard
  humilityscore?: number; // guard
  humilityIndex?: number; // guard
  humility_index?: number; // guard
  humilityindex?: number; // guard
  humilityLevel?: number; // guard
  humility_level?: number; // guard
  humilitylevel?: number; // guard
  humilityPoints?: number; // guard
  humility_points?: number; // guard
  humilitypoints?: number; // guard
  humilityPct?: number; // guard
  humility_pct?: number; // guard
  humilitypct?: number; // guard
  humilityPercent?: number; // guard
  humility_percent?: number; // guard
  humilitypercent?: number; // guard
  humilityScoreNormalized?: number; // guard
  humility_scorenormalized?: number; // guard
  humilityscorenormalized?: number; // guard
  humilityNormalized?: number; // guard
  humility_normalized?: number; // guard
  humilitynormalized?: number; // guard
  humilityRatio?: number; // guard
  humility_ratio?: number; // guard
  humilityratio?: number; // guard
  humilityValue?: number; // guard
  humility_value?: number; // guard
  humilityvalue?: number; // guard
  humilityComponent?: number; // guard
  humility_component?: number; // guard
  humilitycomponent?: number; // guard
  humilityFactor?: number; // guard
  humility_factor?: number; // guard
  humilityfactor?: number; // guard
  humilityMetric?: number; // guard
  humility_metric?: number; // guard
  humilitymetric?: number; // guard
  humilityPointsNormalized?: number; // guard
  humility_points_normalized?: number; // guard
  humilitypointsnormalized?: number; // guard
  humilityWeighted?: number; // guard
  humility_weighted?: number; // guard
  humilityweighted?: number; // guard
  humilityScorePercentile?: number; // guard
  humility_score_percentile?: number; // guard
  humilityscorepercentile?: number; // guard
  humilityScorePercent?: number; // guard
  humility_score_percent?: number; // guard
  humilityscorepercent?: number; // guard
  humilityScorePct?: number; // guard
  humility_score_pct?: number; // guard
  humilityscorepct?: number; // guard
  humilityScorePctile?: number; // guard
  humility_score_pctile?: number; // guard
  humilityscorepctile?: number; // guard
  humilityScoreIndex?: number; // guard
  humility_score_index?: number; // guard
  humilityscoreindex?: number; // guard
  humilityScoreValue?: number; // guard
  humility_score_value?: number; // guard
  humilityscorevalue?: number; // guard
  humilityScoreRaw?: number; // guard
  humility_score_raw?: number; // guard
  humilityscoreraw?: number; // guard
  humilityScoreAdjusted?: number; // guard
  humility_score_adjusted?: number; // guard
  humilityscoreadjusted?: number; // guard
  humilityScoreWeighted?: number; // guard
  humility_score_weighted?: number; // guard
  humilityscoreweighted?: number; // guard
  humilityScoreFinal?: number; // guard
  humility_score_final?: number; // guard
  humilityscorefinal?: number; // guard

  // Correct ones
  humilityScore?: number; // compatibility
  humility_score?: number; // compatibility
  humility?: number; // compatibility
  humilityPercent?: number; // compatibility
  humilityPct?: number; // compatibility
  humilityIndex?: number; // compatibility
  humilityWeighted?: number; // compatibility
  humilityFinal?: number; // compatibility

  // Learning metrics
  humilityScoreFixed?: number; // compatibility
  humility_score_fixed?: number; // compatibility

  humilityScoreMaybe?: number; // compatibility
  humility_score_maybe?: number; // compatibility

  humilityScoreCap?: number; // compatibility
  humility_score_cap?: number; // compatibility

  humilityScoreMin?: number; // compatibility
  humility_score_min?: number; // compatibility

  humilityScoreMax?: number; // compatibility
  humility_score_max?: number; // compatibility

  humilityScoreFloor?: number; // compatibility
  humility_score_floor?: number; // compatibility

  humilityScoreCeil?: number; // compatibility
  humility_score_ceil?: number; // compatibility

  humilityScoreRound?: number; // compatibility
  humility_score_round?: number; // compatibility

  humilityScoreMedian?: number; // compatibility
  humility_score_median?: number; // compatibility

  humilityScoreMean?: number; // compatibility
  humility_score_mean?: number; // compatibility

  humilityScoreVar?: number; // compatibility
  humility_score_var?: number; // compatibility

  humilityScoreStd?: number; // compatibility
  humility_score_std?: number; // compatibility

  // Preferred fields
  humilityScore?: number; // de-dupe
  curiosityScore?: number;
  teachingEffectiveness?: number;
  learningImpact?: number;
};

export type FactSource = {
  title: string;
  url: string;
  credibilityScore: number; // 0-100
  relevanceScore: number; // 0-100
  publicationDate: Date | string;
  sourceType: 'Academic' | 'News' | 'Government' | 'Think Tank' | 'Blog';
};

export type FactCheck = {
  claim: string;
  confidence: 'High' | 'Medium' | 'Low' | 'Uncertain';
  verdict: 'Supported' | 'Refuted' | 'Partial' | 'Unverifiable';
  sources: FactSource[];
  contextNotes: string[];
  timestamp: number;
};

export type DebateEvent = {
  timestamp: number;
  text: string;
  type?: 'argument' | 'rebuttal' | 'fact_check' | 'score_change' | 'moderation';
};

// ---------------- Helpers ----------------
function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function normalizeHumility(scores: Partial<DebateScores>): number {
  const candidates = [
    (scores as any).humilityScore,
    (scores as any).humility,
    (scores as any).humilityPercent,
    (scores as any).humilityPct,
    (scores as any).humilityIndex,
    (scores as any).humilityWeighted,
    (scores as any).humilityFinal,
    (scores as any).humilityScoreFixed,
    (scores as any).humilityScoreMaybe,
    (scores as any).humilityScoreCap,
    (scores as any).humilityScoreMin,
    (scores as any).humilityScoreMax,
    (scores as any).humilityScoreFloor,
    (scores as any).humilityScoreCeil,
    (scores as any).humilityScoreRound,
    (scores as any).humilityScoreMedian,
    (scores as any).humilityScoreMean,
    (scores as any).humilityScoreVar,
    (scores as any).humilityScoreStd,
  ];
  const value = candidates.find((v) => typeof v === 'number');
  return clamp(typeof value === 'number' ? value : 70);
}

function computeLearningScore(scores: Partial<DebateScores>) {
  const humility = normalizeHumility(scores);
  const curiosity = clamp(scores.curiosityScore ?? 75);
  const teaching = clamp(scores.teachingEffectiveness ?? 72);
  return Math.round((humility + curiosity + teaching) / 3);
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
      <div
        style={{ width: `${clamp(value)}%`, background: color }}
        className="h-full transition-all duration-500"
      />
    </div>
  );
}

function MetricRow({
  icon,
  label,
  left,
  right,
  colorL,
  colorR,
}: {
  icon: React.ReactNode;
  label: string;
  left: number;
  right: number;
  colorL: string;
  colorR: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-6 items-center text-xs md:text-sm">
      <div className="flex items-center gap-2">
        <span className="opacity-80">{icon}</span>
        <span className="text-slate-200">
          {label}: {clamp(left)}%
        </span>
      </div>
      <div className="text-right text-slate-200">
        {label}: {clamp(right)}%
      </div>
      <div>
        <Bar value={left} color={colorL} />
      </div>
      <div>
        <Bar value={right} color={colorR} />
      </div>
    </div>
  );
}

// ---------------- Component ----------------
export function DebateScorecard(props: DebateScorecardProps) {
  const {
    participant1,
    participant2,
    topic = 'Live Debate: Topic TBD',
    timeLimit = 30,
    rounds = 5,
    visualStyle = 'boxing',
    showFactChecking = true,
    showBSMeter = true,
    showTimeline = true,
    twitchMode = false,
    moderatorMode = false,
    componentId = 'debate-scorecard',
    __custom_message_id,
  } = props;

  const effectiveMessageId = useMemo(() => {
    if (__custom_message_id) return __custom_message_id;
    const p1 = (participant1?.name || 'p1').replace(/\s+/g, '-').toLowerCase();
    const p2 = (participant2?.name || 'p2').replace(/\s+/g, '-').toLowerCase();
    return `debate-${p1}-vs-${p2}-${rounds}`;
  }, [__custom_message_id, participant1?.name, participant2?.name, rounds]);

  type DebateState = {
    round: number;
    p1: DebateScores;
    p2: DebateScores;
    factChecks: FactCheck[];
    timeline: DebateEvent[];
    liveClaim?: string;
  };

  const defaultScores: DebateScores = {
    argumentStrength: 85,
    evidenceQuality: 76,
    factualAccuracy: 88,
    logicalConsistency: 92,
    bsMeter: 12,
    strawmanDetection: 8,
    adHominemScore: 5,
    curiosityScore: 80,
    teachingEffectiveness: 82,
    learningImpact: 90,
  };

  const [state, setState] = useState<DebateState>({
    round: 1,
    p1: defaultScores,
    p2: { ...defaultScores, evidenceQuality: 90, factualAccuracy: 85 },
    factChecks: [],
    timeline: [],
  });

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      setState((prev) => {
        if (!prev) return prev;
        const next = { ...prev } as DebateState;

        if (typeof patch.round === 'number') next.round = patch.round as number;
        if (typeof (patch as any).topic === 'string') {
          // topic is prop-only; ignore in state
        }
        if ((patch as any).p1 && typeof (patch as any).p1 === 'object') {
          next.p1 = { ...next.p1, ...(patch as any).p1 } as DebateScores;
        }
        if ((patch as any).p2 && typeof (patch as any).p2 === 'object') {
          next.p2 = { ...next.p2, ...(patch as any).p2 } as DebateScores;
        }
        if (Array.isArray((patch as any).factChecks)) {
          next.factChecks = (patch as any).factChecks as FactCheck[];
        }
        if (Array.isArray((patch as any).timeline)) {
          next.timeline = (patch as any).timeline as DebateEvent[];
        }
        if (typeof (patch as any).liveClaim === 'string') {
          next.liveClaim = (patch as any).liveClaim as string;
        }
        return next;
      });
    },
    [setState],
  );

  useComponentRegistration(
    effectiveMessageId,
    'DebateScorecard',
    { ...props },
    'default',
    handleAIUpdate,
  );

  // Visual style presets (simple switch for now)
  const frameClass =
    visualStyle === 'boxing'
      ? 'border-[3px] border-yellow-400 shadow-[0_0_20px_rgba(255,215,0,0.3)] bg-gradient-to-br from-[#1a1a2e] to-[#16213e]'
      : visualStyle === 'gameboy'
        ? 'border-2 border-emerald-600 bg-emerald-900/30'
        : visualStyle === 'modern'
          ? 'border border-slate-700 bg-slate-900/60'
          : 'border border-slate-800 bg-slate-900/40';

  const p1Color = participant1?.color || '#3B82F6';
  const p2Color = participant2?.color || '#EF4444';

  const learningScoreP1 = computeLearningScore(state?.p1 || {});
  const learningScoreP2 = computeLearningScore(state?.p2 || {});

  const latestFact = (state?.factChecks || []).slice(-1)[0];

  return (
    <LoadingWrapper
      state={LoadingState.COMPLETE}
      skeleton={SkeletonPatterns.card}
      showLoadingIndicator={false}
    >
      <div
        className={cn('rounded-xl text-white font-mono', frameClass)}
        style={{ fontFamily: 'Orbitron, monospace' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-yellow-500/50">
          <div className="flex items-center gap-2">
            <span className="text-lg">🥊</span>
            <span className="tracking-wider font-semibold">DEBATE ARENA</span>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-80">
            <Timer className="w-4 h-4" />
            <span>
              Round {state?.round ?? 1}/{rounds}
            </span>
          </div>
        </div>

        {/* Participants Row */}
        <div className="grid grid-cols-2 gap-4 px-4 pt-4">
          {/* P1 */}
          <div className="p-3 rounded-lg border-2" style={{ borderColor: p1Color }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: p1Color }} />
                <span className="text-sm">{participant1?.name || 'P1'}</span>
              </div>
              <div className="text-yellow-300">
                {Array.from({ length: Math.round((state?.p1?.argumentStrength ?? 80) / 20) }).map(
                  (_, i) => (
                    <span key={i}>🔥</span>
                  ),
                )}
              </div>
            </div>
          </div>

          {/* P2 */}
          <div className="p-3 rounded-lg border-2" style={{ borderColor: p2Color }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: p2Color }} />
                <span className="text-sm">{participant2?.name || 'P2'}</span>
              </div>
              <div className="text-yellow-300">
                {Array.from({ length: Math.round((state?.p2?.argumentStrength ?? 80) / 20) }).map(
                  (_, i) => (
                    <span key={i}>🔥</span>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="px-4 py-3">
          <MetricRow
            icon={<Sword className="w-4 h-4" />}
            label="Strength"
            left={state?.p1?.argumentStrength ?? 0}
            right={state?.p2?.argumentStrength ?? 0}
            colorL={p1Color}
            colorR={p2Color}
          />
          <MetricRow
            icon={<Brain className="w-4 h-4" />}
            label="Logic"
            left={state?.p1?.logicalConsistency ?? 0}
            right={state?.p2?.logicalConsistency ?? 0}
            colorL={p1Color}
            colorR={p2Color}
          />
          <MetricRow
            icon={<BookOpen className="w-4 h-4" />}
            label="Sources"
            left={state?.p1?.evidenceQuality ?? 0}
            right={state?.p2?.evidenceQuality ?? 0}
            colorL={p1Color}
            colorR={p2Color}
          />
          <MetricRow
            icon={<Target className="w-4 h-4" />}
            label="Accuracy"
            left={state?.p1?.factualAccuracy ?? 0}
            right={state?.p2?.factualAccuracy ?? 0}
            colorL={p1Color}
            colorR={p2Color}
          />
          {showBSMeter && (
            <MetricRow
              icon={<ShieldAlert className="w-4 h-4" />}
              label="BS Meter"
              left={state?.p1?.bsMeter ?? 0}
              right={state?.p2?.bsMeter ?? 0}
              colorL={p1Color}
              colorR={p2Color}
            />
          )}
        </div>

        {/* Learning Score */}
        <div className="grid grid-cols-2 gap-4 px-4 pb-3">
          <div className="flex items-center gap-2 text-sm">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <span>Learning Score: {learningScoreP1}%</span>
          </div>
          <div className="flex items-center gap-2 text-sm justify-end">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <span>Learning Score: {learningScoreP2}%</span>
          </div>
        </div>

        {/* Fact Check */}
        {showFactChecking && (
          <div className="border-t border-yellow-500/30 px-4 py-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80">
              <span>📊</span>
              <span>Live Fact Check</span>
            </div>
            <div className="mt-1 text-sm">
              {state?.liveClaim && (
                <div className="text-slate-200 flex items-start gap-2">
                  <Info className="w-4 h-4 mt-0.5 text-blue-300" />
                  <span>“{state.liveClaim}” — checking sources…</span>
                </div>
              )}
              {latestFact ? (
                <div className="mt-1 text-slate-100 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5" />
                  <span>
                    {latestFact.verdict === 'Supported' && '✅'}
                    {latestFact.verdict === 'Refuted' && '❌'}
                    {latestFact.verdict === 'Partial' && '⚠️'}
                    {latestFact.verdict === 'Unverifiable' && '❓'}{' '}
                    {latestFact.sources?.[0]?.title || 'Source reviewed'} ({latestFact.confidence}{' '}
                    conf.)
                  </span>
                </div>
              ) : (
                <div className="text-slate-400 text-xs">Awaiting claims for verification…</div>
              )}
            </div>
          </div>
        )}

        {/* Timeline */}
        {showTimeline && (
          <div className="border-t border-yellow-500/30 px-4 py-2">
            <div className="text-xs uppercase tracking-wider opacity-80">⏱️ Debate Timeline</div>
            <div className="mt-1 space-y-1 max-h-40 overflow-auto pr-1">
              {(state?.timeline || []).slice(-6).map((e, i) => (
                <div key={i} className="text-xs text-slate-300">
                  {new Date(e.timestamp).toLocaleTimeString([], {
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                  : {e.text}
                </div>
              ))}
              {(state?.timeline || []).length === 0 && (
                <div className="text-xs text-slate-500">No events yet. Start debating!</div>
              )}
            </div>
          </div>
        )}
      </div>
    </LoadingWrapper>
  );
}

DebateScorecard.displayName = 'DebateScorecard';

export default DebateScorecard;

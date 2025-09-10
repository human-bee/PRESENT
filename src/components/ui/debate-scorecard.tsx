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
import { Users, Sparkles, Gavel, XCircle, FlaskConical, Pin, History } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';

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
  humility?: number;
  curiosityScore?: number;
  teachingEffectiveness?: number;
  learningImpact?: number;
  [key: string]: any; // tolerate legacy/variant fields; normalization handles them
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

type TopicSection = {
  topic: string;
  color: string;
  weight: number;
};

// ---------------- Claim Ledger Types ----------------
type ClaimVerdict = 'Supported' | 'Refuted' | 'Partial' | 'Unverifiable' | undefined;
type ClaimVisual = { type: 'image' | 'chart' | 'link'; url: string; title?: string };
type ClaimEntry = {
  id: string;
  timestamp: number;
  text: string;
  verdict?: ClaimVerdict;
  speaker?: string;
  side?: 'p1' | 'p2' | 'mod' | 'audience';
  refutesClaimId?: string | null;
  deepResearch?: { done: boolean; sources: FactSource[]; results?: string[] };
  visuals?: ClaimVisual[];
  points?: { crowd: number; bonus: number };
};

type ClaimLedger = {
  entries: ClaimEntry[];
  summary: {
    claimsMade: number;
    claimsCorrect: number;
    refutes: number;
    crowdPoints: number;
    bonusPoints: number;
    momentum: number; // consecutive correct claims
  };
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
    rounds = 5,
    visualStyle = 'boxing',
    showFactChecking = true,
    showBSMeter = true,
    showTimeline = true,
    __custom_message_id,
  } = props;

  // Injected TLDraw shape state for persistence & sync
  const injectedShapeState = (props as any)?.state as Record<string, unknown> | undefined;
  const updateShapeState = (props as any)?.updateState as
    | ((patch: Record<string, unknown> | ((prev: any) => any)) => void)
    | undefined;

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
    topicSections?: TopicSection[];
  };

  const defaultScores: DebateScores = {
    argumentStrength: 0,
    evidenceQuality: 0,
    factualAccuracy: 0,
    logicalConsistency: 0,
    bsMeter: 0,
    strawmanDetection: 0,
    adHominemScore: 0,
    curiosityScore: 0,
    teachingEffectiveness: 0,
    learningImpact: 0,
  };

  const [state, setState] = useState<DebateState>({
    round: 1,
    p1: { ...defaultScores },
    p2: { ...defaultScores },
    factChecks: [],
    timeline: [],
    topicSections: [],
  });

  // --------------- Ledger State (Synced via TLDraw shape state) ---------------
  const defaultLedger: ClaimLedger = {
    entries: [],
    summary: {
      claimsMade: 0,
      claimsCorrect: 0,
      refutes: 0,
      crowdPoints: 0,
      bonusPoints: 0,
      momentum: 0,
    },
  };

  const [ledger, setLedger] = useState<ClaimLedger>(
    ((injectedShapeState as any)?.debateLedger as ClaimLedger) || defaultLedger,
  );
  const [activeTab, setActiveTab] = useState<'summary' | 'ledger'>(
    ((injectedShapeState as any)?.debateLedgerTab as 'summary' | 'ledger') || 'summary',
  );

  // Sync inbound TLDraw shape state changes
  React.useEffect(() => {
    const incoming = (injectedShapeState as any)?.debateLedger;
    if (incoming && JSON.stringify(incoming) !== JSON.stringify(ledger)) {
      setLedger(incoming as ClaimLedger);
    }
    const incomingTab = (injectedShapeState as any)?.debateLedgerTab;
    if (incomingTab && incomingTab !== activeTab) {
      setActiveTab(incomingTab as 'summary' | 'ledger');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedShapeState?.debateLedger, injectedShapeState?.debateLedgerTab]);

  const recomputeSummary = useCallback((entries: ClaimEntry[]) => {
    const claimsMade = entries.length;
    const claimsCorrect = entries.filter((e) => e.verdict === 'Supported').length;
    const refutes = entries.filter((e) => !!e.refutesClaimId).length;
    const crowdPoints = entries.reduce((acc, e) => acc + (e.points?.crowd || 0), 0);
    const bonusPoints = entries.reduce((acc, e) => acc + (e.points?.bonus || 0), 0);
    let momentum = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].verdict === 'Supported') momentum++;
      else break;
    }
    return { claimsMade, claimsCorrect, refutes, crowdPoints, bonusPoints, momentum };
  }, []);

  const persistLedger = useCallback(
    (updater: ClaimLedger | ((prev: ClaimLedger) => ClaimLedger)) => {
      setLedger((prev) => {
        const next = typeof updater === 'function' ? (updater as any)(prev) : updater;
        try {
          updateShapeState?.({ debateLedger: next });
        } catch {}
        return next;
      });
    },
    [updateShapeState],
  );

  const persistTab = useCallback(
    (tab: 'summary' | 'ledger') => {
      setActiveTab(tab);
      try {
        updateShapeState?.({ debateLedgerTab: tab });
      } catch {}
    },
    [updateShapeState],
  );

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      // Dev visibility for round-trip UI updates
      try {
        console.log('[DebateScorecard] handleAIUpdate', typeof patch === 'object' ? JSON.stringify(patch) : String(patch));
      } catch {}
      // Normalize wrapper shapes like { update: {...} } or { updates: {...} }
      const patchData = ((patch as any)?.update || (patch as any)?.updates || patch) as Record<string, unknown>;
      // Alias common keys
      if ((patchData as any)['BS meter'] !== undefined && (patchData as any).bsMeter === undefined) {
        (patchData as any).bsMeter = (patchData as any)['BS meter'];
      }
      if ((patchData as any)['live fact checks'] !== undefined && (patchData as any).factChecks === undefined) {
        (patchData as any).factChecks = (patchData as any)['live fact checks'];
      }
      // Label → numeric helpers
      const labelToPercent = (label: unknown): number | null => {
        if (typeof label !== 'string') return null;
        const l = label.trim().toLowerCase();
        if (!l) return null;
        if (/^very\s*low|poor|bad|weak|unreliable$/.test(l)) return 10;
        if (/^low|below\s*average|questionable|mixed$/.test(l)) return 30;
        if (/^moderate|average|ok|fair$/.test(l)) return 50;
        if (/^high|good|strong|reliable$/.test(l)) return 75;
        if (/^very\s*high|excellent|outstanding$/.test(l)) return 90;
        if (/^true|supported$/.test(l)) return 90;
        if (/^false|refuted$/.test(l)) return 10;
        return null;
      };
      const bsLabelToPercent = (label: unknown): number | null => {
        if (typeof label !== 'string') return null;
        const l = label.trim().toLowerCase();
        if (/^very\s*low$/.test(l)) return 5;
        if (/^low$/.test(l)) return 15;
        if (/^medium|moderate$/.test(l)) return 35;
        if (/^high$/.test(l)) return 65;
        if (/^very\s*high$/.test(l)) return 85;
        return null;
      };
      setState((prev) => {
        if (!prev) return prev;
        const next = { ...prev } as DebateState;

        if (typeof patchData.round === 'number') next.round = patchData.round as number;
        if (typeof (patchData as any).topic === 'string') {
          // topic is prop-only; ignore in state
        }
        // Absolute assignments only from explicit p1/p2
        const p1Patch = (patchData as any).p1;
        const p2Patch = (patchData as any).p2;
        if (p1Patch && typeof p1Patch === 'object') {
          const incoming = p1Patch as Partial<DebateScores>;
          const merged: DebateScores = { ...next.p1 } as DebateScores;
          for (const [k, v] of Object.entries(incoming)) {
            const current = (merged as any)[k];
            const numeric = typeof v === 'number' ? v : labelToPercent(v);
            if (typeof current === 'number' && numeric !== null) {
              (merged as any)[k] = numeric;
            }
          }
          next.p1 = merged;
        }
        if (p2Patch && typeof p2Patch === 'object') {
          const incoming = p2Patch as Partial<DebateScores>;
          const merged: DebateScores = { ...next.p2 } as DebateScores;
          for (const [k, v] of Object.entries(incoming)) {
            const current = (merged as any)[k];
            const numeric = typeof v === 'number' ? v : labelToPercent(v);
            if (typeof current === 'number' && numeric !== null) {
              (merged as any)[k] = numeric;
            }
          }
          next.p2 = merged;
        }
        // Apply additive deltas when provided
        if ((patchData as any).p1Delta && typeof (patchData as any).p1Delta === 'object') {
          const incoming = (patchData as any).p1Delta as Partial<DebateScores>;
          const merged: DebateScores = { ...next.p1 } as DebateScores;
          for (const [k, v] of Object.entries(incoming)) {
            const current = (merged as any)[k];
            if (typeof current === 'number' && typeof v === 'number') (merged as any)[k] = clamp(current + v);
          }
          next.p1 = merged;
        }
        if ((patchData as any).p2Delta && typeof (patchData as any).p2Delta === 'object') {
          const incoming = (patchData as any).p2Delta as Partial<DebateScores>;
          const merged: DebateScores = { ...next.p2 } as DebateScores;
          for (const [k, v] of Object.entries(incoming)) {
            const current = (merged as any)[k];
            if (typeof current === 'number' && typeof v === 'number') (merged as any)[k] = clamp(current + v);
          }
          next.p2 = merged;
        }
        // Map common top-level fields to both sides for convenience
        const topMap: Array<[string, keyof DebateScores]> = [
          ['strength', 'argumentStrength'],
          ['logic', 'logicalConsistency'],
          ['sources', 'evidenceQuality'],
          ['accuracy', 'factualAccuracy'],
          ['bsMeter', 'bsMeter'],
        ];
        for (const [from, to] of topMap) {
          const raw = (patchData as any)[from] ?? (from === 'bsMeter' ? (patchData as any)['BS meter'] : undefined);
          let numeric: number | null = null;
          if (typeof raw === 'number') numeric = raw;
          else numeric = from === 'bsMeter' ? bsLabelToPercent(raw) : labelToPercent(raw);
          if (numeric !== null) {
            (next.p1 as any)[to] = numeric;
            (next.p2 as any)[to] = numeric;
          }
        }
        if (Array.isArray((patchData as any).factChecks)) {
          const raw = (patchData as any).factChecks as any[];
          const normalized: FactCheck[] = raw.map((fc) => {
            const ts = typeof fc?.timestamp === 'number' ? fc.timestamp : Date.now();
            let sources = fc?.sources as any[] | undefined;
            if (!sources && typeof fc?.sourcesText === 'string' && fc.sourcesText.trim()) {
              sources = [{ title: fc.sourcesText.trim(), url: '', credibilityScore: 0, relevanceScore: 0, publicationDate: '', sourceType: 'Blog' }];
            }
            return {
              claim: String(fc?.claim || ''),
              verdict:
                fc?.verdict ||
                (typeof fc?.status === 'string'
                  ? fc.status.toLowerCase() === 'true'
                    ? 'Supported'
                    : fc.status.toLowerCase() === 'false'
                      ? 'Refuted'
                      : 'Unverifiable'
                  : 'Unverifiable'),
              confidence: typeof fc?.confidence === 'number' ? fc.confidence : 0,
              sources: Array.isArray(sources) ? (sources as any) : [],
              contextNotes: Array.isArray(fc?.contextNotes)
                ? fc.contextNotes
                : typeof fc?.reason === 'string'
                  ? [fc.reason]
                  : [],
              timestamp: ts,
            } as FactCheck;
          });
          next.factChecks = normalized;
        }
        if (Array.isArray((patchData as any).timeline)) {
          const raw = (patchData as any).timeline as any[];
          const normalized: DebateEvent[] = raw.map((e) => {
            let text = typeof e?.text === 'string' ? e.text : String(e?.event || '');
            if (!text && (e as any)?.argument) {
              const parts = [
                (e as any)?.speaker ? String((e as any).speaker) + ':' : null,
                (e as any)?.argument || (e as any)?.claim || null,
                (e as any)?.counter ? `— Counter: ${(e as any).counter}` : null,
              ].filter(Boolean);
              text = parts.join(' ');
            }
            let ts: number;
            if (typeof e?.timestamp === 'number') ts = e.timestamp;
            else if (typeof e?.timestamp === 'string' && e.timestamp.toLowerCase() === 'now') ts = Date.now();
            else ts = Date.now();
            return { timestamp: ts, text, type: e?.type } as DebateEvent;
          });
          next.timeline = normalized;
        }
        if (Array.isArray((patchData as any).topicSections)) {
          next.topicSections = (patchData as any).topicSections as TopicSection[];
        }
        if (typeof (patchData as any).liveClaim === 'string') {
          next.liveClaim = (patchData as any).liveClaim as string;
        }
        try {
          console.log(
            '[DebateScorecard] state after patch',
            JSON.stringify(
              {
                p1: next.p1,
                p2: next.p2,
                liveClaim: next.liveClaim,
                lastFactCheck: (next.factChecks || []).slice(-1)[0] || null,
                timelineTail: (next.timeline || []).slice(-3),
              },
              null,
              2,
            ),
          );
        } catch {}
        return next;
      });

      // ---------------- Claim Ledger Handling ----------------
      try {
        const now = Date.now();
        const appendClaim = (raw: any) => {
          let entry: ClaimEntry | null = null;
          if (typeof raw === 'string') {
            entry = {
              id: nanoid(),
              timestamp: now,
              text: raw,
              verdict: undefined,
              speaker: undefined,
              side: undefined,
              refutesClaimId: null,
              deepResearch: { done: false, sources: [], results: [] },
              visuals: [],
              points: { crowd: 0, bonus: 0 },
            };
          } else if (raw && typeof raw === 'object') {
            entry = {
              id: String((raw as any).id || nanoid()),
              timestamp:
                typeof (raw as any).timestamp === 'number' ? (raw as any).timestamp : now,
              text: String((raw as any).text || (raw as any).claim || ''),
              verdict: (raw as any).verdict,
              speaker: (raw as any).speaker,
              side: (raw as any).side,
              refutesClaimId: (raw as any).refutesClaimId || null,
              deepResearch: (raw as any).deepResearch || { done: false, sources: [], results: [] },
              visuals: Array.isArray((raw as any).visuals) ? (raw as any).visuals : [],
              points: (raw as any).points || { crowd: 0, bonus: 0 },
            };
          }
          if (!entry || !entry.text) return;
          persistLedger((prev) => {
            const entries = [...prev.entries, entry as ClaimEntry];
            const summary = recomputeSummary(entries);
            // Combo bonus: clever improvement - reward streaks
            if (summary.momentum >= 3) {
              const bonus = 1; // small combo bonus
              summary.bonusPoints += bonus;
            }
            return { entries, summary };
          });
        };

        // Add claims from various keys
        const singleClaim = (patchData as any).addClaim || (patchData as any).claim || (patchData as any).statement || (patchData as any).assertion;
        if (singleClaim) appendClaim(singleClaim);
        const claimsArray = (patchData as any).claims || (patchData as any).claimsToAdd;
        if (Array.isArray(claimsArray)) {
          for (const c of claimsArray) appendClaim(c);
        }

        // Replace entire ledger (if provided)
        if (Array.isArray((patchData as any).claimsReplace)) {
          const normalized = ((patchData as any).claimsReplace as any[]).map((c) => ({
            id: String((c as any).id || nanoid()),
            timestamp: typeof (c as any).timestamp === 'number' ? (c as any).timestamp : now,
            text: String((c as any).text || (c as any).claim || ''),
            verdict: (c as any).verdict as ClaimVerdict,
            speaker: (c as any).speaker,
            side: (c as any).side,
            refutesClaimId: (c as any).refutesClaimId || null,
            deepResearch: (c as any).deepResearch || { done: false, sources: [], results: [] },
            visuals: Array.isArray((c as any).visuals) ? (c as any).visuals : [],
            points: (c as any).points || { crowd: 0, bonus: 0 },
          } as ClaimEntry));
          persistLedger({ entries: normalized, summary: recomputeSummary(normalized) });
        }

        // Helpers to find target claim
        const findTargetIndex = (target: any, entries: ClaimEntry[]) => {
          if (!entries.length) return -1;
          if (!target || target === 'latest' || target === 'last') return entries.length - 1;
          const byId = entries.findIndex((e) => e.id === target);
          if (byId >= 0) return byId;
          if (typeof target === 'number' && target >= 0 && target < entries.length) return target;
          return entries.length - 1;
        };

        // Verdict update
        if ((patchData as any).verdict || (patchData as any).setVerdict) {
          const verdict = (patchData as any).verdict || (patchData as any).setVerdict;
          const target = (patchData as any).claimId || (patchData as any).targetClaim || 'latest';
          persistLedger((prev) => {
            const entries = [...prev.entries];
            const i = findTargetIndex(target, entries);
            if (i >= 0) entries[i] = { ...entries[i], verdict };
            const summary = recomputeSummary(entries);
            return { entries, summary };
          });
        }

        // Refute link
        if ((patchData as any).refute || (patchData as any).refutes) {
          const refutesTarget = (patchData as any).refutes || (patchData as any).refute;
          const target = (patchData as any).claimId || (patchData as any).targetClaim || 'latest';
          persistLedger((prev) => {
            const entries = [...prev.entries];
            const i = findTargetIndex(target, entries);
            const j = findTargetIndex(refutesTarget, entries);
            if (i >= 0 && j >= 0) entries[i] = { ...entries[i], refutesClaimId: entries[j].id };
            const summary = recomputeSummary(entries);
            return { entries, summary };
          });
        }

        // Deep research enrichment
        if ((patchData as any).deepResearch || (patchData as any).research) {
          const r = (patchData as any).deepResearch || (patchData as any).research;
          const target = r?.claimId || (patchData as any).claimId || 'latest';
          persistLedger((prev) => {
            const entries = [...prev.entries];
            const i = findTargetIndex(target, entries);
            if (i >= 0) {
              const sources: FactSource[] = Array.isArray(r?.sources) ? r.sources : [];
              const results: string[] = Array.isArray(r?.results)
                ? (r.results as string[])
                : typeof r?.summary === 'string'
                  ? [r.summary]
                  : [];
              const deepResearch = { done: true, sources, results };
              entries[i] = { ...entries[i], deepResearch };
            }
            const summary = recomputeSummary(entries);
            return { entries, summary };
          });
        }

        // Award points
        if ((patchData as any).award || (patchData as any).points || (patchData as any).crowdPoints || (patchData as any).bonusPoints) {
          const award = (patchData as any).award || (patchData as any).points || {};
          const crowd = (patchData as any).crowdPoints ?? award.crowd ?? 0;
          const bonus = (patchData as any).bonusPoints ?? award.bonus ?? 0;
          const target = award.claimId || (patchData as any).claimId || 'latest';
          persistLedger((prev) => {
            const entries = [...prev.entries];
            const i = findTargetIndex(target, entries);
            if (i >= 0) {
              const prevPoints = entries[i].points || { crowd: 0, bonus: 0 };
              entries[i] = {
                ...entries[i],
                points: { crowd: (prevPoints.crowd || 0) + (crowd || 0), bonus: (prevPoints.bonus || 0) + (bonus || 0) },
              };
            }
            const summary = recomputeSummary(entries);
            // Also add to global summary in case not tied to a particular claim
            summary.crowdPoints += typeof (patchData as any).crowdPoints === 'number' ? (patchData as any).crowdPoints : 0;
            summary.bonusPoints += typeof (patchData as any).bonusPoints === 'number' ? (patchData as any).bonusPoints : 0;
            return { entries, summary };
          });
        }

        // Switch tab
        if (typeof (patchData as any).switchTab === 'string' || typeof (patchData as any).view === 'string') {
          const tab = ((patchData as any).switchTab || (patchData as any).view).toLowerCase();
          if (tab.includes('ledger')) persistTab('ledger');
          else if (tab.includes('score') || tab.includes('summary')) persistTab('summary');
        }

        // Pin claim to canvas (clever additional feature)
        if ((patchData as any).pinClaim) {
          const target = (patchData as any).pinClaim; // 'latest' | id | index
          const entries = ledger.entries;
          const idx = findTargetIndex(target, entries);
          const text = idx >= 0 ? `Claim: ${entries[idx].text}\nVerdict: ${entries[idx].verdict || '—'}` : 'Claim';
          try {
            window.dispatchEvent(
              new CustomEvent('tldraw:create_note', {
                detail: { text },
              }),
            );
          } catch {}
        }
      } catch {}
    },
    [setState, persistLedger, persistTab, recomputeSummary, ledger.entries],
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
  const latestClaim = ledger.entries[ledger.entries.length - 1];
  const mostRecentCorrect = [...ledger.entries].reverse().find((e) => e.verdict === 'Supported');
  const mostRecentWrong = [...ledger.entries].reverse().find((e) => e.verdict === 'Refuted');

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
          <div className="flex items-center gap-3 text-sm opacity-80">
            <button
              onClick={() => persistTab(activeTab === 'summary' ? 'ledger' : 'summary')}
              className="px-2 py-1 rounded-md border border-yellow-500/40 hover:border-yellow-400/80 transition-colors"
            >
              {activeTab === 'summary' ? (
                <span className="inline-flex items-center gap-1"><History className="w-4 h-4" /> Ledger</span>
              ) : (
                <span className="inline-flex items-center gap-1"><Trophy className="w-4 h-4" /> Summary</span>
              )}
            </button>
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4" />
              <span>
                Round {state?.round ?? 1}/{rounds}
              </span>
            </div>
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

        {/* Summary or Ledger View */}
        <AnimatePresence mode="wait">
          {activeTab === 'summary' ? (
            <motion.div key="summary" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
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

              {/* Animated Counters Row */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 pb-2">
                <motion.div layout className="rounded-lg border border-yellow-500/30 p-2 text-sm flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-yellow-300" />
                  <div>
                    <div className="text-xs opacity-80">Claims Made</div>
                    <div className="text-lg font-semibold">{ledger.summary.claimsMade}</div>
                  </div>
                </motion.div>
                <motion.div layout className="rounded-lg border border-green-500/30 p-2 text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <div>
                    <div className="text-xs opacity-80">Claims Correct</div>
                    <div className="text-lg font-semibold">{ledger.summary.claimsCorrect}</div>
                  </div>
                </motion.div>
                <motion.div layout className="rounded-lg border border-blue-500/30 p-2 text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-300" />
                  <div>
                    <div className="text-xs opacity-80">Crowd Points</div>
                    <div className="text-lg font-semibold">{ledger.summary.crowdPoints}</div>
                  </div>
                </motion.div>
                <motion.div layout className="rounded-lg border border-purple-500/30 p-2 text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-300" />
                  <div>
                    <div className="text-xs opacity-80">Bonus Points</div>
                    <div className="text-lg font-semibold">{ledger.summary.bonusPoints}</div>
                  </div>
                </motion.div>
                <motion.div layout className="rounded-lg border border-red-500/30 p-2 text-sm flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-300" />
                  <div>
                    <div className="text-xs opacity-80">Refutes</div>
                    <div className="text-lg font-semibold">{ledger.summary.refutes}</div>
                  </div>
                </motion.div>
                {/* Clever improvement: Momentum meter */}
                <motion.div layout className="rounded-lg border border-amber-500/30 p-2 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <FlaskConical className="w-4 h-4 text-amber-300" />
                    <div className="text-xs opacity-80">Momentum</div>
                  </div>
                  <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, ledger.summary.momentum * 20)}%`, background: 'linear-gradient(90deg,#f59e0b,#84cc16)' }}
                      className="h-full transition-all duration-500"
                    />
                  </div>
                </motion.div>
              </div>

              {/* Latest claim widgets */}
              <div className="px-4 pb-3">
                <div className="rounded-md border border-yellow-500/30 p-2">
                  <div className="text-xs uppercase tracking-wider opacity-80 mb-1">Most Recent Claim</div>
                  {latestClaim ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <div className="text-slate-100">“{latestClaim.text}”</div>
                        <div className="text-xs text-slate-400 mt-1">
                          Verdict: {latestClaim.verdict || '—'}
                          {latestClaim.deepResearch?.done && (
                            <span className="ml-2 inline-flex items-center gap-1 text-emerald-300">
                              <FlaskConical className="w-3 h-3" /> Deep research
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="text-xs px-2 py-1 rounded-md border border-yellow-500/40 hover:border-yellow-400/80 transition-colors inline-flex items-center gap-1"
                        onClick={() => {
                          try {
                            window.dispatchEvent(new CustomEvent('tldraw:create_note', { detail: { text: `Claim: ${latestClaim.text}\nVerdict: ${latestClaim.verdict || '—'}` } }));
                          } catch {}
                        }}
                      >
                        <Pin className="w-3 h-3" /> Pin
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">No claims yet.</div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="rounded-md border border-green-500/30 p-2">
                    <div className="text-xs uppercase tracking-wider opacity-80 mb-1">Most Recent Right</div>
                    {mostRecentCorrect ? (
                      <div className="text-sm text-slate-100">“{mostRecentCorrect.text}”</div>
                    ) : (
                      <div className="text-xs text-slate-500">—</div>
                    )}
                  </div>
                  <div className="rounded-md border border-red-500/30 p-2">
                    <div className="text-xs uppercase tracking-wider opacity-80 mb-1">Most Recent Wrong</div>
                    {mostRecentWrong ? (
                      <div className="text-sm text-slate-100">“{mostRecentWrong.text}”</div>
                    ) : (
                      <div className="text-xs text-slate-500">—</div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="ledger" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {/* Post-modern ledger table */}
              <div className="px-4 pb-3">
                <div className="text-xs uppercase tracking-wider opacity-80 mb-2">Claim Ledger</div>
                <div className="rounded-lg overflow-hidden border border-slate-700">
                  <div className="grid grid-cols-6 gap-0 text-[11px] bg-slate-900/60">
                    <div className="px-2 py-2 border-b border-slate-700">Time</div>
                    <div className="px-2 py-2 border-b border-slate-700 col-span-2">Claim</div>
                    <div className="px-2 py-2 border-b border-slate-700">Verdict</div>
                    <div className="px-2 py-2 border-b border-slate-700">Research</div>
                    <div className="px-2 py-2 border-b border-slate-700">Points</div>
                  </div>
                  <div className="max-h-52 overflow-auto">
                    {ledger.entries.length === 0 && (
                      <div className="px-3 py-4 text-xs text-slate-500">No entries yet. As claims are made, they will appear here with research and sources.</div>
                    )}
                    {ledger.entries.map((e) => (
                      <div key={e.id} className="grid grid-cols-6 gap-0 text-[11px] border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                        <div className="px-2 py-2 text-slate-400">
                          {new Date(e.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                        </div>
                        <div className="px-2 py-2 col-span-2">
                          <div className="text-slate-100">{e.text}</div>
                          {e.refutesClaimId && (
                            <div className="text-[10px] text-amber-300">refutes #{e.refutesClaimId.slice(0, 5)}</div>
                          )}
                          {Array.isArray(e.visuals) && e.visuals.length > 0 && (
                            <div className="mt-1 flex gap-1 flex-wrap">
                              {e.visuals.slice(0, 3).map((v, i) => (
                                <a key={i} href={v.url} target="_blank" rel="noreferrer" className="text-[10px] underline opacity-80 hover:opacity-100">{v.title || v.type}</a>
                              ))}
                              {e.visuals.length > 3 && <span className="text-[10px] opacity-60">+{e.visuals.length - 3} more</span>}
                            </div>
                          )}
                        </div>
                        <div className="px-2 py-2">
                          {e.verdict || '—'}
                        </div>
                        <div className="px-2 py-2">
                          {e.deepResearch?.done ? (
                            <div>
                              <div className="text-emerald-300 inline-flex items-center gap-1"><FlaskConical className="w-3 h-3" /> done</div>
                              {Array.isArray(e.deepResearch?.sources) && e.deepResearch!.sources.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {e.deepResearch!.sources.slice(0, 2).map((s, i) => (
                                    <a key={i} href={s.url} target="_blank" rel="noreferrer" className="block text-[10px] underline text-sky-300 truncate">{s.title}</a>
                                  ))}
                                  {e.deepResearch!.sources.length > 2 && (
                                    <div className="text-[10px] text-slate-500">+{e.deepResearch!.sources.length - 2} more</div>
                                  )}
                                </div>
                              )}
                              {Array.isArray(e.deepResearch?.results) && e.deepResearch!.results.length > 0 && (
                                <div className="mt-1 text-[10px] text-slate-300 line-clamp-2">{e.deepResearch!.results[0]}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </div>
                        <div className="px-2 py-2">
                          <div className="text-sky-300">Crowd: {e.points?.crowd || 0}</div>
                          <div className="text-purple-300">Bonus: {e.points?.bonus || 0}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

        {/* Topic Sections */}
        {Array.isArray(state?.topicSections) && state.topicSections.length > 0 && (
          <div className="border-t border-yellow-500/30 px-4 py-2">
            <div className="text-xs uppercase tracking-wider opacity-80">🧩 Topic Sections</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {state.topicSections.map((s, i) => (
                <div
                  key={i}
                  className="rounded-md border p-2 text-xs"
                  style={{ borderColor: s.color }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color: s.color }}>
                      {s.topic}
                    </span>
                    <span className="opacity-80">weight {Math.round((s.weight || 0) * 100)}%</span>
                  </div>
                </div>
              ))}
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

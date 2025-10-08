'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  FileText,
  Filter,
  Map as MapIcon,
  Layers3,
  Search,
  ShieldCheck,
  ShieldMinus,
  ShieldAlert,
  ShieldX,
  GaugeCircle,
  ArrowRightLeft,
  BarChart3,
  FileOutput,
  BookOpen,
  Info,
  ClipboardList,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Link2,
  History,
  Gavel,
} from 'lucide-react';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// Schema & Types
// ------------------------------------------------------------

export const verdictEnum = z.enum(['ACCURATE', 'PARTIALLY_TRUE', 'UNSUPPORTED', 'FALSE']);
export type Verdict = z.infer<typeof verdictEnum>;

export const impactEnum = z.enum(['KEY_VOTER', 'MAJOR', 'MINOR', 'CREDIBILITY_HIT', 'DROPPED']);
export type Impact = z.infer<typeof impactEnum>;

export const evidenceRefSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  credibility: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).default('UNKNOWN'),
  type: z.enum(['Academic', 'News', 'Government', 'Think Tank', 'Blog']).default('Academic'),
  lastVerified: z.string().optional(), // ISO
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const factCheckNoteSchema = z.object({
  id: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
});
export type FactCheckNote = z.infer<typeof factCheckNoteSchema>;

export const claimSchema = z.object({
  id: z.string(),
  side: z.enum(['AFF', 'NEG']),
  speech: z.enum(['1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR']),
  quote: z.string(),
  evidenceInline: z.string().optional(),
  factChecks: z.array(factCheckNoteSchema).default([]),
  verdict: verdictEnum.optional(),
  impact: impactEnum.optional(),
  mapNodeId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Claim = z.infer<typeof claimSchema>;

export const mapNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['MAIN', 'REASON', 'OBJECTION', 'REBUTTAL']),
  label: z.string(),
  claimId: z.string().optional(),
});
export type MapNode = z.infer<typeof mapNodeSchema>;

export const mapEdgeSchema = z.object({ from: z.string(), to: z.string() });
export type MapEdge = z.infer<typeof mapEdgeSchema>;

export const rfdLinkSchema = z.object({ id: z.string(), claimId: z.string(), excerpt: z.string() });
export type RFDLink = z.infer<typeof rfdLinkSchema>;

export const roundMetricsSchema = z.object({
  roundScore: z.number().default(0),
  evidenceQuality: z.number().default(0),
  judgeLean: z.enum(['AFF', 'NEG', 'NEUTRAL']).default('NEUTRAL'),
});
export type RoundMetrics = z.infer<typeof roundMetricsSchema>;

export const timelineEventSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  text: z.string(),
  type: z.enum(['argument', 'rebuttal', 'fact_check', 'score_change', 'moderation']).default('argument'),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const debateScorecardSchema = z.object({
  componentId: z.string().default('debate-scorecard'),
  topic: z.string().default('Untitled debate'),
  round: z.string().default('Prelim Round'),
  showMetricsStrip: z.boolean().default(true),
  factCheckEnabled: z.boolean().default(true),
  filters: z
    .object({
      speaker: z.union([
        z.enum(['ALL', 'AFF', 'NEG', '1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR']),
        z.null(),
      ])
        .default('ALL')
        .nullable(),
      verdicts: z.array(verdictEnum).default([]),
      searchQuery: z.string().default(''),
      activeTab: z.enum(['ledger', 'map', 'rfd', 'sources']).default('ledger'),
    })
    .default({ speaker: 'ALL', verdicts: [], searchQuery: '', activeTab: 'ledger' }),
  metrics: roundMetricsSchema.default({ roundScore: 0.67, evidenceQuality: 0.55, judgeLean: 'AFF' }),
  claims: z.array(claimSchema).default([]),
  map: z
    .object({ nodes: z.array(mapNodeSchema).default([]), edges: z.array(mapEdgeSchema).default([]) })
    .default({ nodes: [], edges: [] }),
  rfd: z
    .object({
      summary: z.string().default('Judge has not submitted an RFD yet.'),
      links: z.array(rfdLinkSchema).default([]),
    })
    .default({ summary: 'Judge has not submitted an RFD yet.', links: [] }),
  sources: z.array(evidenceRefSchema).default([]),
  timeline: z.array(timelineEventSchema).default([]),
});

export type DebateScorecardProps = z.infer<typeof debateScorecardSchema>;
// Backwards compatibility alias (legacy code imports debateScoreCardSchema)
export const debateScoreCardSchema = debateScorecardSchema;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const verdictConfig: Record<
  Verdict,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  ACCURATE: { label: 'Accurate', className: 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/30', icon: CheckCircle2 },
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
  FALSE: { label: 'False', className: 'bg-red-600/15 text-red-400 border border-red-500/30', icon: ShieldX },
};

const impactConfig: Record<Impact, { label: string; className: string }> = {
  KEY_VOTER: { label: 'Key Voter', className: 'bg-blue-500/10 text-blue-300 border border-blue-400/40' },
  MAJOR: { label: 'Major', className: 'bg-sky-500/10 text-sky-300 border border-sky-400/40' },
  MINOR: { label: 'Minor', className: 'bg-slate-500/10 text-slate-300 border border-slate-400/40' },
  CREDIBILITY_HIT: {
    label: 'Credibility Hit',
    className: 'bg-purple-500/10 text-purple-300 border border-purple-400/40',
  },
  DROPPED: { label: 'Dropped', className: 'bg-neutral-500/10 text-neutral-300 border border-neutral-400/40' },
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

function verdictBadge(verdict?: Verdict) {
  if (!verdict) return null;
  const cfg = verdictConfig[verdict];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium', cfg.className)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function impactBadge(impact?: Impact) {
  if (!impact) return null;
  const cfg = impactConfig[impact];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium', cfg.className)}>
      <Sparkles className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return value;
  }
}

// ------------------------------------------------------------
// Components
// ------------------------------------------------------------

function MetricsStrip({ metrics, show }: { metrics: RoundMetrics; show: boolean }) {
  if (!show) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-sm">
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
          <p className="text-lg font-medium text-white">{metrics.judgeLean === 'NEUTRAL' ? 'Neutral' : metrics.judgeLean}</p>
        </div>
        <ArrowRightLeft className="w-8 h-8 text-sky-400" />
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/60">Evidence Quality</p>
          <p className="text-2xl font-semibold text-white">{Math.round(metrics.evidenceQuality * 100)}%</p>
        </div>
        <BarChart3 className="w-8 h-8 text-amber-400" />
      </div>
    </div>
  );
}

function LedgerTable({
  claims,
  factCheckEnabled,
}: {
  claims: Claim[];
  factCheckEnabled: boolean;
}) {
  if (!claims.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/60 gap-2 border border-dashed border-white/10 rounded-xl">
        <ClipboardList className="w-10 h-10" />
        <p className="font-medium">No claims captured yet.</p>
        <p className="text-xs text-white/40">Record arguments with the voice agent or by typing in the transcript.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
      <table className="min-w-full text-sm text-white/80">
        <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/60">
          <tr>
            <th className="px-4 py-3 text-left">Claim ID</th>
            <th className="px-4 py-3 text-left">Speaker</th>
            <th className="px-4 py-3 text-left">Core Claim</th>
            {factCheckEnabled && <th className="px-4 py-3 text-left">Fact-Check Notes</th>}
            <th className="px-4 py-3 text-left">Evaluation</th>
            <th className="px-4 py-3 text-left">Impact</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {claims.map((claim) => (
            <tr key={claim.id} className="hover:bg-white/[0.03]">
              <td className="px-4 py-3 font-semibold text-white">{claim.id}</td>
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="font-medium text-white/90">{speechLabels[claim.speech] || claim.speech}</span>
                  <span className="text-xs text-white/40">{claim.side}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <p className="text-white/90">{claim.quote}</p>
                {claim.evidenceInline && (
                  <p className="text-xs text-white/40 mt-1 italic">Evidence: {claim.evidenceInline}</p>
                )}
              </td>
              {factCheckEnabled && (
                <td className="px-4 py-3">
                  {claim.factChecks.length === 0 ? (
                    <span className="text-xs text-white/40">No research notes</span>
                  ) : (
                    <ul className="flex flex-col gap-1 text-xs text-white/70">
                      {claim.factChecks.map((note) => (
                        <li key={note.id} className="flex items-start gap-2">
                          <Info className="w-3.5 h-3.5 mt-0.5 text-white/40" />
                          <span>{note.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              )}
              <td className="px-4 py-3 space-y-2">
                {verdictBadge(claim.verdict as Verdict)}
                {claim.factChecks.length > 0 && (
                  <span className="block text-[11px] text-white/40">{claim.factChecks.length} research note(s)</span>
                )}
              </td>
              <td className="px-4 py-3">{impactBadge(claim.impact as Impact)}</td>
            </tr>
          ))}
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
          <p className="uppercase tracking-wide text-[10px] text-white/30">Legend</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-1 rounded-full bg-blue-500/15 text-blue-200">Main</span>
            <span className="px-2 py-1 rounded-full bg-white/10 text-white/80">Reason</span>
            <span className="px-2 py-1 rounded-full bg-orange-500/15 text-orange-200">Objection</span>
            <span className="px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-200">Rebuttal</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RFDView({ summary, links, claims }: { summary: string; links: RFDLink[]; claims: Claim[] }) {
  return (
    <div className="grid md:grid-cols-5 gap-4">
      <div className="md:col-span-3 rounded-xl border border-white/5 bg-white/[0.03] p-5 space-y-3 text-sm text-white/80">
        <h3 className="text-white font-semibold flex items-center gap-2 text-base">
          <Gavel className="w-5 h-5" />
          Reason For Decision
        </h3>
        <p className="leading-relaxed whitespace-pre-line text-white/80">{summary}</p>
      </div>
      <div className="md:col-span-2 rounded-xl border border-white/5 bg-white/[0.03] p-5 text-sm space-y-3">
        <h3 className="text-white font-medium flex items-center gap-2 text-sm">
          <Link2 className="w-4 h-4" />
          Linked Voters
        </h3>
        {links.length === 0 ? (
          <p className="text-xs text-white/40">Judge has not linked any claims to the RFD.</p>
        ) : (
          <ul className="space-y-2 text-xs text-white/70">
            {links.map((link) => {
              const claim = claims.find((c) => c.id === link.claimId);
              return (
                <li key={link.id} className="border border-white/5 rounded-lg p-2">
                  <p className="font-semibold text-white/90">{claim?.id || link.claimId}</p>
                  <p className="text-[11px] text-white/50">{claim?.quote || 'Claim not found'}</p>
                  <p className="mt-1 text-white/70">“{link.excerpt}”</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SourcesView({ sources }: { sources: EvidenceRef[] }) {
  if (!sources.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/60 gap-2 border border-dashed border-white/10 rounded-xl">
        <BookOpen className="w-10 h-10" />
        <p className="font-medium">No sources logged yet.</p>
        <p className="text-xs text-white/40">As claims are fact-checked, add citations so the audit trail stays complete.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
      <table className="min-w-full text-sm text-white/80">
        <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/60">
          <tr>
            <th className="px-4 py-3 text-left">Title</th>
            <th className="px-4 py-3 text-left">Type</th>
            <th className="px-4 py-3 text-left">Credibility</th>
            <th className="px-4 py-3 text-left">Last Verified</th>
            <th className="px-4 py-3 text-left">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sources.map((source) => (
            <tr key={source.id} className="hover:bg-white/[0.03]">
              <td className="px-4 py-3">
                <p className="text-white/90 font-medium">{source.title || 'Untitled source'}</p>
                <p className="text-xs text-white/40">{source.url}</p>
              </td>
              <td className="px-4 py-3 text-xs text-white/60">{source.type}</td>
              <td className="px-4 py-3 text-xs text-white/60">{source.credibility}</td>
              <td className="px-4 py-3 text-xs text-white/60">{formatDate(source.lastVerified)}</td>
              <td className="px-4 py-3 text-xs">
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-white/30">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const timelineItems = useMemo(() => {
    const seen = new Set<string>();
    return events
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((event) => {
        const key = event.id || `${event.timestamp}-${event.text}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [events]);

  if (!timelineItems.length) return null;
  return (
    <div className="mt-8">
      <h3 className="text-white font-medium flex items-center gap-2 text-sm">
        <History className="w-4 h-4" />
        Timeline
      </h3>
      <ul className="mt-3 space-y-2 text-xs text-white/70">
        {timelineItems.map((event, index) => {
          const key = event.id || `${event.timestamp}-${index}`;
          return (
            <li key={key} className="flex items-start gap-2">
              <span className="text-white/30">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-white/80">{event.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------
// Main Component
// ------------------------------------------------------------

export function DebateScorecard(props: DebateScorecardProps) {
  const parsed = useMemo(() => debateScorecardSchema.parse(props), [props]);
  const messageId = (props as any).__custom_message_id || parsed.componentId || 'debate-scorecard';
  useComponentRegistration(messageId, 'DebateScorecard', parsed, 'canvas');

  const [localFilters, setLocalFilters] = useState(parsed.filters);
  const [factCheckToggle, setFactCheckToggle] = useState(parsed.factCheckEnabled);

  useEffect(() => {
    setLocalFilters(parsed.filters);
  }, [parsed.filters]);

  useEffect(() => {
    setFactCheckToggle(parsed.factCheckEnabled);
  }, [parsed.factCheckEnabled]);

  const filteredClaims = useMemo(() => {
    return parsed.claims.filter((claim) => {
      if (localFilters.speaker && localFilters.speaker !== 'ALL') {
        if (localFilters.speaker === 'AFF' && claim.side !== 'AFF') return false;
        if (localFilters.speaker === 'NEG' && claim.side !== 'NEG') return false;
        if (
          ['1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR'].includes(localFilters.speaker || '') &&
          claim.speech !== localFilters.speaker
        )
          return false;
      }
      if (localFilters.verdicts.length && (!claim.verdict || !localFilters.verdicts.includes(claim.verdict))) {
        return false;
      }
      if (localFilters.searchQuery.trim().length) {
        const q = localFilters.searchQuery.toLowerCase();
        if (!claim.quote.toLowerCase().includes(q) && !(claim.evidenceInline || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [parsed.claims, localFilters]);

  return (
    <div className="w-full rounded-2xl border border-white/5 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)] p-6 md:p-8 text-white font-sans">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-white/40">Debate Analysis</p>
          <h2 className="text-2xl md:text-3xl font-semibold text-white mt-1">{parsed.topic}</h2>
          <p className="text-sm text-white/50">{parsed.round}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition',
              localFilters.activeTab === 'ledger' && 'border-white/30 bg-white/[0.09]',
            )}
            onClick={() => setLocalFilters((prev) => ({ ...prev, activeTab: 'ledger' }))}
          >
            <FileText className="w-4 h-4" /> Ledger
          </button>
          <button
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition',
              localFilters.activeTab === 'map' && 'border-white/30 bg-white/[0.09]',
            )}
            onClick={() => setLocalFilters((prev) => ({ ...prev, activeTab: 'map' }))}
          >
            <MapIcon className="w-4 h-4" /> Map
          </button>
          <button
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition',
              localFilters.activeTab === 'rfd' && 'border-white/30 bg-white/[0.09]',
            )}
            onClick={() => setLocalFilters((prev) => ({ ...prev, activeTab: 'rfd' }))}
          >
            <Gavel className="w-4 h-4" /> Judge RFD
          </button>
          <button
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition',
              localFilters.activeTab === 'sources' && 'border-white/30 bg-white/[0.09]',
            )}
            onClick={() => setLocalFilters((prev) => ({ ...prev, activeTab: 'sources' }))}
          >
            <BookOpen className="w-4 h-4" /> Sources
          </button>
        </div>
      </header>

      <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
            <GaugeCircle className="w-4 h-4" />
            <span className="font-medium text-white/80">{Math.round(parsed.metrics.roundScore * 100)}% round score</span>
          </div>
          <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 cursor-pointer">
            <ShieldCheck className="w-4 h-4" />
            <span className="font-medium text-white/70">Fact-check</span>
            <input
              type="checkbox"
              className="accent-emerald-400"
              checked={factCheckToggle}
              onChange={(e) => setFactCheckToggle(e.target.checked)}
            />
          </label>
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
        </div>
        <div className="flex gap-2 justify-end">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Search claims, evidence, notes"
              value={localFilters.searchQuery}
              onChange={(e) => setLocalFilters((prev) => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-white/30"
            />
          </div>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] text-xs">
            <FileOutput className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      <MetricsStrip metrics={parsed.metrics} show={parsed.showMetricsStrip} />

      <div className="mt-6">
        {localFilters.activeTab === 'ledger' && (
          <LedgerTable claims={filteredClaims} factCheckEnabled={factCheckToggle} />
        )}
        {localFilters.activeTab === 'map' && (
          <MapView nodes={parsed.map.nodes} edges={parsed.map.edges} />
        )}
        {localFilters.activeTab === 'rfd' && (
          <RFDView summary={parsed.rfd.summary} links={parsed.rfd.links} claims={parsed.claims} />
        )}
        {localFilters.activeTab === 'sources' && <SourcesView sources={parsed.sources} />}
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3 text-xs text-white/70">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
          <p className="text-white font-medium flex items-center gap-2 text-sm">
            <ShieldAlert className="w-4 h-4" /> Verdict legend
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(verdictConfig).map(([key, cfg]) => (
              <span key={key} className={cn('px-2 py-1 rounded-full text-[11px] font-medium', cfg.className)}>
                {cfg.label}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
          <p className="text-white font-medium flex items-center gap-2 text-sm">
            <Info className="w-4 h-4" /> How to use
          </p>
          <ol className="list-decimal list-inside space-y-1 text-white/70">
            <li>Record every claim verbatim.</li>
            <li>Verify sources and add fact-check notes.</li>
            <li>Set verdict + impact as you weigh voters.</li>
            <li>Link key voters to the judge’s RFD.</li>
          </ol>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 space-y-2">
          <p className="text-white font-medium flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4" /> Tips
          </p>
          <ul className="space-y-1 text-white/70">
            <li>Drag ledger rows into the map to expose clash.</li>
            <li>Use filters to prep a judge-facing summary fast.</li>
            <li>Export JSON to rehydrate the scorecard later.</li>
          </ul>
        </div>
      </div>

      <Timeline events={parsed.timeline} />
    </div>
  );
}

export default DebateScorecard;

import { Agent as OpenAIAgent, run as runAgent, tool as agentTool } from '@openai/agents';
import { z } from 'zod';

// ------------------------------------------------------------
// Shared types (mirrors UI schema)
// ------------------------------------------------------------

type Verdict = 'ACCURATE' | 'PARTIALLY_TRUE' | 'UNSUPPORTED' | 'FALSE';
type Impact = 'KEY_VOTER' | 'MAJOR' | 'MINOR' | 'CREDIBILITY_HIT' | 'DROPPED';

type EvidenceRef = {
  id: string;
  title?: string;
  url?: string;
  credibility: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  type: 'Academic' | 'News' | 'Government' | 'Think Tank' | 'Blog';
  lastVerified?: string;
};

type FactCheckNote = {
  id: string;
  summary: string;
  tags: string[];
  evidenceRefs: string[];
};

type Claim = {
  id: string;
  side: 'AFF' | 'NEG';
  speech: '1AC' | '1NC' | '2AC' | '2NC' | '1AR' | '1NR' | '2AR' | '2NR';
  quote: string;
  evidenceInline?: string;
  factChecks: FactCheckNote[];
  verdict?: Verdict;
  impact?: Impact;
  mapNodeId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type MapNode = {
  id: string;
  type: 'MAIN' | 'REASON' | 'OBJECTION' | 'REBUTTAL';
  label: string;
  claimId?: string;
};

type MapEdge = { from: string; to: string };

type RFDLink = { id: string; claimId: string; excerpt: string };

type TimelineEvent = {
  id: string;
  timestamp: number;
  text: string;
  type: 'argument' | 'rebuttal' | 'fact_check' | 'score_change' | 'moderation';
};

export function isStartDebate(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!/\bdebate\b/.test(lower)) return false;
  return /\b(start|begin|launch|create|open|setup|set\s*up|initiate|kick\s*off|analysis|scorecard)\b/.test(lower);
}

type ScorecardState = {
  componentId: string;
  topic: string;
  round: string;
  showMetricsStrip: boolean;
  factCheckEnabled: boolean;
  filters: {
    speaker: 'ALL' | 'AFF' | 'NEG' | '1AC' | '1NC' | '2AC' | '2NC' | '1AR' | '1NR' | '2AR' | '2NR';
    verdicts: Verdict[];
    searchQuery: string;
    activeTab: 'ledger' | 'map' | 'rfd' | 'sources';
  };
  metrics: {
    roundScore: number;
    evidenceQuality: number;
    judgeLean: 'AFF' | 'NEG' | 'NEUTRAL';
  };
  claims: Claim[];
  map: { nodes: MapNode[]; edges: MapEdge[] };
  rfd: { summary: string; links: RFDLink[] };
  sources: EvidenceRef[];
  timeline: TimelineEvent[];
};

// ------------------------------------------------------------
// Room interface & helpers
// ------------------------------------------------------------

interface RoomLike {
  name?: string;
  localParticipant?: {
    publishData: (
      data: Uint8Array,
      options?: { reliable?: boolean; topic?: string },
    ) => unknown;
  } | null;
}

function now() {
  return new Date().toISOString();
}

function defaultState(topic: string): ScorecardState {
  return {
    componentId: 'debate-scorecard',
    topic,
    round: 'Round',
    showMetricsStrip: true,
    factCheckEnabled: true,
    filters: { speaker: 'ALL', verdicts: [], searchQuery: '', activeTab: 'ledger' },
    metrics: { roundScore: 0.5, evidenceQuality: 0.5, judgeLean: 'NEUTRAL' },
    claims: [],
    map: { nodes: [], edges: [] },
    rfd: { summary: 'Judge has not submitted an RFD yet.', links: [] },
    sources: [],
    timeline: [],
  };
}

function mergeArraysById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item] as const));
  for (const item of incoming) {
    byId.set(item.id, { ...byId.get(item.id), ...item });
  }
  return Array.from(byId.values());
}

function randomId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// ------------------------------------------------------------
// Debate judge manager
// ------------------------------------------------------------

export class DebateJudgeManager {
  private room: RoomLike;
  private roomName: string;
  private messageId: string | null = null;
  private judge: OpenAIAgent | null = null;
  private state: ScorecardState;

  constructor(room: RoomLike, roomName: string) {
    this.room = room;
    this.roomName = roomName || 'room';
    this.state = defaultState('Untitled debate');
  }

  isActive(): boolean {
    return !!this.judge;
  }

  getMessageId(): string | null {
    return this.messageId;
  }

  async activate(topic: string, messageId?: string): Promise<string> {
    if (!this.messageId) {
      this.messageId = messageId || `debate-scorecard-${Date.now()}`;
      this.state = defaultState(topic || 'Untitled debate');
      await this.publishCreate();
      this.judge = this.createAgent();
    }
    return this.messageId;
  }

  async ensureScorecard(topic: string): Promise<string> {
    if (!this.messageId) {
      return this.activate(topic);
    }
    if (topic && topic !== this.state.topic) {
      await this.applyPatch({ topic });
    }
    return this.messageId;
  }

  private async publishData(topic: string, payload: unknown) {
    try {
      this.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
        topic,
      });
    } catch (err) {
      console.warn('[DebateJudge] publishData failed', topic, err);
    }
  }

  private async publishToolCall(tool: string, params: Record<string, unknown>) {
    const event = {
      id: `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      roomId: this.room.name || 'unknown',
      type: 'tool_call' as const,
      payload: {
        tool,
        params,
        context: { source: 'debate-judge', timestamp: Date.now() },
      },
      timestamp: Date.now(),
      source: 'voice',
    };
    await this.publishData('tool_call', event);
  }

  private async publishCreate() {
    if (!this.messageId) return;
    await this.publishToolCall('create_component', {
      type: 'DebateScorecard',
      messageId: this.messageId,
      componentId: this.messageId,
      ...this.state,
    });
  }

  private async publishUpdate(patch: Partial<ScorecardState>) {
    if (!this.messageId) return;
    await this.publishToolCall('update_component', {
      componentId: this.messageId,
      patch,
    });
  }

  private async applyPatch(patch: Partial<ScorecardState>) {
    this.state = {
      ...this.state,
      ...patch,
      filters: patch.filters ? { ...this.state.filters, ...patch.filters } : this.state.filters,
      metrics: patch.metrics ? { ...this.state.metrics, ...patch.metrics } : this.state.metrics,
      map: patch.map
        ? {
            nodes: patch.map.nodes ?? this.state.map.nodes,
            edges: patch.map.edges ?? this.state.map.edges,
          }
        : this.state.map,
      rfd: patch.rfd ? { ...this.state.rfd, ...patch.rfd } : this.state.rfd,
      claims: patch.claims ?? this.state.claims,
      sources: patch.sources ?? this.state.sources,
      timeline: patch.timeline ?? this.state.timeline,
    };
    await this.publishUpdate(patch);
  }

  private createAgent(): OpenAIAgent {
    const manager = this;

    const ensureScorecardTool = agentTool({
      name: 'ensure_scorecard',
      description: 'Ensure the debate analysis scorecard is visible. Provide the debate topic.',
      parameters: z.object({ topic: z.string() }),
      async execute({ topic }) {
        await manager.ensureScorecard(topic);
        return { status: 'ready', messageId: manager.messageId };
      },
    });

    const upsertClaimTool = agentTool({
      name: 'upsert_claim',
      description:
        'Create or update a ledger row. Provide claimId, side, speech, quote, optional evidence summary, verdict, impact, and research notes.',
      parameters: z.object({
        claim: z.object({
          id: z.union([z.string(), z.null()]),
          side: z.enum(['AFF', 'NEG']),
          speech: z.enum(['1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR']),
          quote: z.string(),
          evidenceInline: z.union([z.string(), z.null()]),
          verdict: z.union([
            z.enum(['ACCURATE', 'PARTIALLY_TRUE', 'UNSUPPORTED', 'FALSE']),
            z.null(),
          ]),
          impact: z.union([
            z.enum(['KEY_VOTER', 'MAJOR', 'MINOR', 'CREDIBILITY_HIT', 'DROPPED']),
            z.null(),
          ]),
          factChecks: z.union([
            z.array(
              z.object({
                summary: z.string(),
                tags: z.union([z.array(z.string()), z.null()]),
                evidenceRefs: z.union([z.array(z.string()), z.null()]),
              }),
            ),
            z.null(),
          ]),
        }),
      }),
      async execute({ claim }) {
        if (!manager.messageId) await manager.ensureScorecard(manager.state.topic);
        const id = claim.id || `${claim.side}-${manager.state.claims.length + 1}`;
        const existing = manager.state.claims.find((row) => row.id === id);
        const factCheckInput = Array.isArray(claim.factChecks) ? claim.factChecks : [];
        const factChecks: FactCheckNote[] = factCheckInput.map((note) => ({
          id: randomId('fc'),
          summary: note.summary,
          tags: Array.isArray(note.tags) ? note.tags : [],
          evidenceRefs: Array.isArray(note.evidenceRefs) ? note.evidenceRefs : [],
        }));
        const updatedClaim: Claim = {
          id,
          side: claim.side,
          speech: claim.speech,
          quote: claim.quote,
          evidenceInline: claim.evidenceInline ?? undefined,
          verdict: claim.verdict ?? undefined,
          impact: claim.impact ?? undefined,
          factChecks: factChecks.length ? factChecks : existing?.factChecks || [],
          createdAt: existing?.createdAt || now(),
          updatedAt: now(),
        };
        await manager.applyPatch({
          claims: mergeArraysById(manager.state.claims, [updatedClaim]),
        });
        return { status: 'UPDATED', claimId: id };
      },
    });

    const appendFactCheckTool = agentTool({
      name: 'append_fact_check',
      description: 'Attach a fact-check note and optional evidence references to a claim.',
      parameters: z.object({
        claimId: z.string(),
        summary: z.string(),
        tags: z.union([z.array(z.string()), z.null()]),
        evidenceRefs: z.union([
          z.array(
            z.object({
              id: z.union([z.string(), z.null()]),
              title: z.union([z.string(), z.null()]),
              url: z.union([z.string(), z.null()]),
              credibility: z.union([
                z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
                z.null(),
              ]),
              type: z.union([
                z.enum(['Academic', 'News', 'Government', 'Think Tank', 'Blog']),
                z.null(),
              ]),
              lastVerified: z.union([z.string(), z.null()]),
            }),
          ),
          z.null(),
        ]),
      }),
      async execute({ claimId, summary, tags, evidenceRefs }) {
        const claim = manager.state.claims.find((c) => c.id === claimId);
        if (!claim) return { status: 'NOT_FOUND', claimId };
        const normalizedRefs: EvidenceRef[] = Array.isArray(evidenceRefs)
          ? evidenceRefs.map((ref) => {
              const id = ref.id && ref.id !== null ? ref.id : randomId('src');
              return {
                id,
                title: ref.title ?? undefined,
                url: ref.url ?? undefined,
                credibility: ref.credibility ?? 'UNKNOWN',
                type: ref.type ?? 'Academic',
                lastVerified: ref.lastVerified ?? undefined,
              };
            })
          : [];
        const note: FactCheckNote = {
          id: randomId('fc'),
          summary,
          tags: Array.isArray(tags) ? tags : [],
          evidenceRefs: normalizedRefs.map((ref) => ref.id),
        };
        const updatedClaim: Claim = {
          ...claim,
          factChecks: [...claim.factChecks, note],
          updatedAt: now(),
        };
        let sources = manager.state.sources;
        if (normalizedRefs.length) {
          sources = mergeArraysById(sources, normalizedRefs);
        }
        await manager.applyPatch({
          claims: mergeArraysById(manager.state.claims, [updatedClaim]),
          sources,
        });
        return { status: 'ADDED', claimId };
      },
    });

    const updateVerdictTool = agentTool({
      name: 'set_verdict',
      description: 'Update a claim verdict and inferred impact.',
      parameters: z.object({
        claimId: z.string(),
        verdict: z.enum(['ACCURATE', 'PARTIALLY_TRUE', 'UNSUPPORTED', 'FALSE']),
        impact: z.union([
          z.enum(['KEY_VOTER', 'MAJOR', 'MINOR', 'CREDIBILITY_HIT', 'DROPPED']),
          z.null(),
        ]),
      }),
      async execute({ claimId, verdict, impact }) {
        const claim = manager.state.claims.find((c) => c.id === claimId);
        if (!claim) return { status: 'NOT_FOUND', claimId };
        const updatedClaim: Claim = {
          ...claim,
          verdict,
          impact: impact ?? claim.impact,
          updatedAt: now(),
        };
        await manager.applyPatch({
          claims: mergeArraysById(manager.state.claims, [updatedClaim]),
        });
        return { status: 'UPDATED', claimId };
      },
    });

    const setMetricsTool = agentTool({
      name: 'set_round_metrics',
      description: 'Adjust round score, evidence quality, or judge lean.',
      parameters: z.object({
        roundScore: z.union([z.number().min(0).max(1), z.null()]),
        evidenceQuality: z.union([z.number().min(0).max(1), z.null()]),
        judgeLean: z.union([z.enum(['AFF', 'NEG', 'NEUTRAL']), z.null()]),
      }),
      async execute({ roundScore, evidenceQuality, judgeLean }) {
        await manager.applyPatch({
          metrics: {
            roundScore:
              typeof roundScore === 'number' ? roundScore : manager.state.metrics.roundScore,
            evidenceQuality:
              typeof evidenceQuality === 'number'
                ? evidenceQuality
                : manager.state.metrics.evidenceQuality,
            judgeLean: judgeLean ?? manager.state.metrics.judgeLean,
          },
        });
        return { status: 'UPDATED' };
      },
    });

    const updateMapTool = agentTool({
      name: 'set_argument_map',
      description: 'Replace the argument map with nodes and optional edges.',
      parameters: z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            type: z.enum(['MAIN', 'REASON', 'OBJECTION', 'REBUTTAL']),
            label: z.string(),
            claimId: z.union([z.string(), z.null()]),
          }),
        ),
        edges: z.union([
          z.array(
            z.object({
              from: z.string(),
              to: z.string(),
            }),
          ),
          z.null(),
        ]),
      }),
      async execute({ nodes, edges }) {
        await manager.applyPatch({ map: { nodes, edges: edges ?? [] } });
        return { status: 'UPDATED', nodes: nodes.length, edges: edges?.length ?? 0 };
      },
    });

    const updateRfdTool = agentTool({
      name: 'update_rfd',
      description: 'Set the judge reason for decision summary and link it to claims.',
      parameters: z.object({
        summary: z.string(),
        links: z.union([
          z.array(
            z.object({
              claimId: z.string(),
              excerpt: z.string(),
            }),
          ),
          z.null(),
        ]),
      }),
      async execute({ summary, links }) {
        const linkInput = Array.isArray(links) ? links : [];
        const normalizedLinks: RFDLink[] = linkInput.map((link) => ({
          id: randomId('rfd-link'),
          claimId: link.claimId,
          excerpt: link.excerpt,
        }));
        await manager.applyPatch({
          rfd: {
            summary,
            links: normalizedLinks,
          },
        });
        return { status: 'UPDATED', linkedClaims: normalizedLinks.length };
      },
    });

    const logTimelineTool = agentTool({
      name: 'log_timeline_event',
      description: 'Append a timeline entry describing a key moment.',
      parameters: z.object({
        text: z.string(),
        type: z.union([
          z.enum(['argument', 'rebuttal', 'fact_check', 'score_change', 'moderation']),
          z.null(),
        ]),
      }),
      async execute({ text, type }) {
        const event: TimelineEvent = {
          id: randomId('evt'),
          text,
          type: type ?? 'argument',
          timestamp: Date.now(),
        };
        await manager.applyPatch({ timeline: [...manager.state.timeline, event] });
        return { status: 'ADDED', eventId: event.id };
      },
    });

    return new OpenAIAgent({
      name: 'DebateJudge',
      instructions:
        `You are an on-the-fly debate analyst.
1. The first time you are asked to start or analyze a debate, immediately call ensure_scorecard with the topic.
2. For every user utterance, decide if it contains a claim (Aff/Neg) or meta request.
3. For each substantive claim, call upsert_claim with:
   - id (reuse existing if provided, otherwise create a side-prefixed code e.g., AFF-1)
   - side (AFF/NEG) and speech (best guess: map “Aff constructive” → 1AC, etc.)
   - quote (verbatim text)
   - optional evidenceInline summary.
4. If you mention research or sources, call append_fact_check with evidence references.
5. When you judge a claim, call set_verdict with verdict + impact tag.
6. Update round metrics (set_round_metrics) when the accuracy balance shifts.
7. Maintain a simple argument map: set_argument_map with nodes linked to claim ids when you identify main contentions or objections.
8. As soon as you articulate the judge’s rationale, call update_rfd with summary + linked claims.
9. Log key moments via log_timeline_event (e.g., “Aff introduces uniforms study”).
Always prefer tools over plain text. Keep spoken output short (“Recorded”, “Fact-checked”, etc.).`,
      model: 'gpt-5-mini',
      tools: [
        ensureScorecardTool,
        upsertClaimTool,
        appendFactCheckTool,
        updateVerdictTool,
        setMetricsTool,
        updateMapTool,
        updateRfdTool,
        logTimelineTool,
      ],
    });
  }

  async runPrompt(prompt: string) {
    if (!this.judge) {
      await this.activate(this.state.topic || 'Debate');
    }
    if (!this.judge) return null;
    if (!this.isActive()) {
      await this.ensureScorecard(this.state.topic || 'Debate');
    }
    if (!this.judge) return null;
    const result = await runAgent(this.judge, prompt);
    return result.finalOutput;
  }
}

import { createDefaultScorecardState } from '@/lib/agents/debate-scorecard-schema';
import type { JsonObject } from '@/lib/utils/json-schema';
import type { ActiveScorecard, ComponentRegistryEntry } from './create-component';
import { inferScorecardTopicFromText, resolveDebatePlayerSeedFromLabels } from './scorecard';

export type EnsuredScorecard = NonNullable<ActiveScorecard>;

type IntentLedgerSummary = {
  intentId: string;
};

type RegisterLedgerInput = {
  intentId: string;
  messageId: string;
  componentType: string;
  slot?: string;
  state?: 'reserved' | 'created' | 'updated';
};

type ScorecardSeedPayload = {
  componentId: string;
  intentId?: string;
  topic?: string;
  seedState?: JsonObject;
};

type ExistingScorecard = {
  id: string;
  info: ComponentRegistryEntry;
  topic?: string;
};

export type ScorecardServiceDeps = {
  getRoomName: () => string;
  componentRegistry: Map<string, ComponentRegistryEntry>;
  getActiveScorecard: () => ActiveScorecard;
  setActiveScorecard: (scorecard: ActiveScorecard) => void;
  findLedgerEntryByMessage: (messageId: string) => IntentLedgerSummary | undefined;
  registerLedgerEntry: (entry: RegisterLedgerInput) => void;
  setLastComponentForType: (type: string, messageId: string) => void;
  setLastCreatedComponentId: (messageId: string | null) => void;
  setLastScorecardProvisionedAt: (createdAt: number) => void;
  listRemoteParticipantLabels: () => string[];
  sendToolCall: (tool: string, params: JsonObject) => Promise<void>;
  sendScorecardSeedTask: (payload: ScorecardSeedPayload) => Promise<void>;
  now?: () => number;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const readTopicFromRecord = (record: unknown): string | undefined => {
  if (!record || typeof record !== 'object') return undefined;
  const topicCandidate = (record as { topic?: unknown }).topic;
  if (!isNonEmptyString(topicCandidate)) return undefined;
  return topicCandidate.trim();
};

const readScorecardTopic = (entry: ComponentRegistryEntry): string | undefined =>
  readTopicFromRecord(entry.props) ?? readTopicFromRecord(entry.state);

const readPlayerLabel = (players: unknown[], side: 'AFF' | 'NEG'): string | undefined => {
  for (const player of players) {
    if (!player || typeof player !== 'object') continue;
    const next = player as { side?: unknown; label?: unknown };
    if (next.side !== side) continue;
    if (typeof next.label === 'string') {
      return next.label;
    }
    return undefined;
  }
  return undefined;
};

const shouldSeedExistingScorecard = (
  existingTopic: string | undefined,
  requestedTopic: string | undefined,
  players: unknown[],
): boolean => {
  const requestedLower = requestedTopic?.toLowerCase();
  const existingLower = existingTopic?.toLowerCase();
  const requestedDifferentTopic =
    isNonEmptyString(requestedTopic) && existingLower !== requestedLower;
  const affLabel = readPlayerLabel(players, 'AFF');
  const negLabel = readPlayerLabel(players, 'NEG');
  const hasDefaultAff =
    typeof affLabel !== 'string' || affLabel.trim().toLowerCase() === 'affirmative';
  const hasDefaultNeg =
    typeof negLabel !== 'string' || negLabel.trim().toLowerCase() === 'negative';
  return requestedDifferentTopic || hasDefaultAff || hasDefaultNeg;
};

export class ScorecardService {
  private ensurePromise: Promise<EnsuredScorecard> | null = null;

  constructor(private readonly deps: ScorecardServiceDeps) {}

  async ensure(topic?: string, contextText?: string): Promise<EnsuredScorecard> {
    const inferredTopic = inferScorecardTopicFromText(contextText);
    const normalizedTopic = isNonEmptyString(topic) ? topic.trim() : inferredTopic;
    const normalizedLower = normalizedTopic?.toLowerCase();

    if (this.ensurePromise) {
      const pending = await this.ensurePromise;
      if (!normalizedLower || pending.topic.toLowerCase() === normalizedLower) {
        return pending;
      }
    }

    const active = this.deps.getActiveScorecard();
    if (active && (!normalizedLower || active.topic.toLowerCase() === normalizedLower)) {
      return active;
    }

    const existing = this.findExistingScorecard(normalizedTopic);
    if (existing) {
      const ledgerEntry = this.deps.findLedgerEntryByMessage(existing.id);
      const resolvedTopic = normalizedTopic ?? existing.topic ?? active?.topic ?? 'Live Debate';
      const intentId =
        (isNonEmptyString(existing.info.intentId) && existing.info.intentId.trim()) ||
        ledgerEntry?.intentId ||
        `debate-scorecard-${existing.id}`;

      existing.info.intentId = intentId;
      existing.info.room = this.currentRoom();
      this.deps.registerLedgerEntry({
        intentId,
        messageId: existing.id,
        componentType: 'DebateScorecard',
        slot: existing.info.slot,
        state: 'updated',
      });
      this.deps.setLastComponentForType('DebateScorecard', existing.id);
      this.deps.setLastCreatedComponentId(existing.id);

      const ensured: EnsuredScorecard = { componentId: existing.id, intentId, topic: resolvedTopic };
      this.deps.setActiveScorecard(ensured);

      const stateCandidate = (existing.info.state || existing.info.props) as {
        players?: unknown;
      };
      const existingPlayers = Array.isArray(stateCandidate.players) ? stateCandidate.players : [];
      const needsSeed = shouldSeedExistingScorecard(existing.topic, normalizedTopic, existingPlayers);
      if (needsSeed) {
        await this.deps.sendScorecardSeedTask({
          componentId: existing.id,
          intentId,
          topic: resolvedTopic,
        });
      }
      return ensured;
    }

    const createScorecard = async (): Promise<EnsuredScorecard> => {
      const topicLabel = normalizedTopic ?? this.deps.getActiveScorecard()?.topic ?? 'Live Debate';
      const intentId = `debate-scorecard-${this.now()}`;
      const messageId = intentId;
      const initialState = createDefaultScorecardState(topicLabel);
      const seedPlayers = resolveDebatePlayerSeedFromLabels(this.deps.listRemoteParticipantLabels());
      for (const player of initialState.players) {
        const seeded = seedPlayers.find((candidate) => candidate.side === player.side);
        if (seeded) {
          player.label = seeded.label;
        }
      }
      initialState.status.lastAction = `Initialized debate${topicLabel ? ` on ${topicLabel}` : ''} with ${seedPlayers[0].label} vs ${seedPlayers[1].label}.`;
      initialState.componentId = messageId;
      initialState.version = 0;
      const createdAt = this.now();
      initialState.lastUpdated = createdAt;

      await this.deps.sendToolCall('reserve_component', {
        type: 'DebateScorecard',
        intentId,
        messageId,
        spec: initialState as unknown as JsonObject,
      });

      await this.deps.sendToolCall('create_component', {
        type: 'DebateScorecard',
        componentId: messageId,
        messageId,
        spec: initialState as unknown as JsonObject,
      });

      await this.deps.sendScorecardSeedTask({
        componentId: messageId,
        intentId,
        topic: topicLabel,
        seedState: initialState as unknown as JsonObject,
      });

      this.deps.componentRegistry.set(messageId, {
        type: 'DebateScorecard',
        createdAt,
        props: initialState as unknown as JsonObject,
        state: initialState as unknown as JsonObject,
        intentId,
        room: this.currentRoom(),
      });
      this.deps.setLastScorecardProvisionedAt(createdAt);
      const ensured: EnsuredScorecard = { componentId: messageId, intentId, topic: topicLabel };
      this.deps.setActiveScorecard(ensured);
      this.deps.setLastComponentForType('DebateScorecard', messageId);
      this.deps.setLastCreatedComponentId(messageId);
      this.deps.registerLedgerEntry({
        intentId,
        messageId,
        componentType: 'DebateScorecard',
        state: 'created',
      });
      return ensured;
    };

    this.ensurePromise = createScorecard();
    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  private findExistingScorecard(topic?: string): ExistingScorecard | null {
    const normalized = topic?.trim().toLowerCase();
    let fallback: ExistingScorecard | null = null;
    for (const [id, info] of this.deps.componentRegistry.entries()) {
      if (info.type !== 'DebateScorecard') continue;
      if (info.room && info.room !== this.currentRoom()) continue;
      const infoTopic = readScorecardTopic(info);
      if (!fallback || info.createdAt > fallback.info.createdAt) {
        fallback = { id, info, topic: infoTopic };
      }
      if (normalized && infoTopic?.toLowerCase() === normalized) {
        return { id, info, topic: infoTopic };
      }
    }
    return fallback;
  }

  private currentRoom(): string {
    const room = this.deps.getRoomName();
    return room || 'room';
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

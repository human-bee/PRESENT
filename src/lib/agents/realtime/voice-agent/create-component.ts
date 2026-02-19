import { randomUUID } from 'crypto';
import { deriveComponentIntent } from '@/lib/agents/shared/deterministic-ids';
import { createDefaultScorecardState } from '@/lib/agents/debate-scorecard-schema';
import type { JsonObject } from '@/lib/utils/json-schema';
import type { RecentCreateFingerprint } from './component-ledger';
import { inferScorecardTopicFromText, resolveDebatePlayerSeedFromLabels } from './scorecard';
import { normalizeComponentPatch, normalizeSpecInput } from './tool-publishing';

const CREATE_COMPONENT_DUPLICATE_TTL_MS = 30_000;

export type ActiveScorecard = {
  componentId: string;
  intentId: string;
  topic: string;
} | null;

export type ComponentRegistryEntry = {
  type: string;
  createdAt: number;
  props: JsonObject;
  state: JsonObject;
  intentId?: string;
  slot?: string;
  room: string;
};

export type CreateComponentArgs = {
  type: string;
  spec?: unknown;
  props?: unknown;
  messageId?: unknown;
  intentId?: unknown;
  slot?: unknown;
};

type IntentLedgerSummary = {
  intentId: string;
  slot?: string;
};

type RegisterLedgerInput = {
  intentId: string;
  messageId: string;
  componentType: string;
  slot?: string;
  state?: 'reserved' | 'created' | 'updated';
};

export type ExecuteCreateComponentDeps = {
  roomName: string;
  currentTurnId: number;
  scorecardSuppressWindowMs: number;
  lastScorecardProvisionedAt: number;
  setLastScorecardProvisionedAt?: (createdAt: number) => void;
  lastUserPrompt?: string;
  activeScorecard: ActiveScorecard;
  findLatestScorecardEntryInRoom: () => { id: string; entry: ComponentRegistryEntry } | null;
  getLastComponentForType: (type: string) => string | undefined;
  setLastComponentForType: (type: string, messageId: string) => void;
  setLastCreatedComponentId: (messageId: string | null) => void;
  getRecentCreateFingerprint: (type: string) => RecentCreateFingerprint | undefined;
  setRecentCreateFingerprint: (type: string, fingerprint: RecentCreateFingerprint) => void;
  getComponentEntry: (messageId: string) => ComponentRegistryEntry | undefined;
  setComponentEntry: (messageId: string, entry: ComponentRegistryEntry) => void;
  findIntentByMessage?: (messageId: string) => IntentLedgerSummary | undefined;
  findLedgerEntryByMessage?: (messageId: string) => IntentLedgerSummary | undefined;
  registerIntentEntry?: (entry: RegisterLedgerInput) => void;
  registerLedgerEntry?: (entry: RegisterLedgerInput) => void;
  listRemoteParticipantLabels: () => string[];
  sendToolCall: (tool: string, params: JsonObject) => Promise<void>;
  sendScorecardSeedTask: (payload: {
    componentId: string;
    intentId?: string;
    topic?: string;
    seedState?: JsonObject;
  }) => Promise<void>;
  setActiveScorecard: (scorecard: ActiveScorecard) => void;
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', 'yes', 'start', 'run', 'running', 'resume', 'play', 'on', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'stop', 'stopped', 'pause', 'paused', 'halt', 'off', '0'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

const normalizeTimerCreateProps = (mergedProps: JsonObject, lastUserPrompt?: string): JsonObject => {
  const next: Record<string, unknown> = { ...mergedProps };

  if (typeof next.autoStart !== 'boolean') {
    const inferredAutoStart = coerceBoolean((next as { isRunning?: unknown }).isRunning);
    if (typeof inferredAutoStart === 'boolean') {
      next.autoStart = inferredAutoStart;
    } else {
      const prompt = (lastUserPrompt || '').toLowerCase();
      const wantsTimer = prompt.includes('timer');
      const wantsStart = wantsTimer && (prompt.includes('start') || prompt.includes('begin') || prompt.includes('run'));
      const wantsNotStart =
        prompt.includes("don't start") ||
        prompt.includes('do not start') ||
        prompt.includes('paused') ||
        prompt.includes('pause');
      if (wantsStart && !wantsNotStart) {
        next.autoStart = true;
      }
    }
  }

  const minutes = coerceNumber((next as { initialMinutes?: unknown }).initialMinutes);
  const seconds = coerceNumber((next as { initialSeconds?: unknown }).initialSeconds);

  const deriveDurationSeconds = (): number | undefined => {
    if (minutes !== undefined || seconds !== undefined) {
      const m = minutes !== undefined ? Math.max(1, Math.round(minutes)) : 5;
      const s = seconds !== undefined ? Math.max(0, Math.min(59, Math.round(seconds))) : 0;
      return m * 60 + s;
    }

    const configuredRaw = coerceNumber((next as { configuredDuration?: unknown }).configuredDuration);
    if (configuredRaw !== undefined) {
      const configuredSeconds =
        configuredRaw >= 60_000 && configuredRaw % 1000 === 0 ? configuredRaw / 1000 : configuredRaw;
      return Math.max(1, Math.round(configuredSeconds));
    }

    const durationRaw =
      coerceNumber((next as { durationSeconds?: unknown }).durationSeconds) ??
      coerceNumber((next as { duration?: unknown }).duration);
    if (durationRaw !== undefined) {
      return Math.max(1, Math.round(durationRaw));
    }

    const timeLeftRaw = coerceNumber((next as { timeLeft?: unknown }).timeLeft);
    if (timeLeftRaw !== undefined) {
      return Math.max(1, Math.round(timeLeftRaw));
    }

    return undefined;
  };

  const durationSeconds = deriveDurationSeconds();
  if (durationSeconds !== undefined) {
    const m = Math.max(1, Math.floor(durationSeconds / 60));
    const s = Math.max(0, Math.min(59, Math.round(durationSeconds % 60)));
    next.initialMinutes = m;
    next.initialSeconds = s;
  }

  delete (next as { isRunning?: unknown }).isRunning;
  delete (next as { timeLeft?: unknown }).timeLeft;
  delete (next as { configuredDuration?: unknown }).configuredDuration;
  delete (next as { durationSeconds?: unknown }).durationSeconds;
  delete (next as { duration?: unknown }).duration;

  return next as JsonObject;
};

const normalizeLooseTopic = (value: string) => {
  const trimmed = value.trim();
  const parts = trimmed.split(' ').filter(Boolean);
  let collapsed = parts.join(' ');
  while (collapsed.length > 0) {
    const last = collapsed[collapsed.length - 1];
    if (last === '?' || last === '!' || last === '.') {
      collapsed = collapsed.slice(0, -1);
      continue;
    }
    break;
  }
  return collapsed;
};

const pickScorecardTopic = (specTopic?: string, promptTopic?: string): string | undefined => {
  const spec = specTopic?.trim();
  const prompt = promptTopic?.trim();
  if (!spec && !prompt) return undefined;
  if (!spec) return prompt;
  if (!prompt) return spec;
  if (spec === prompt) return spec;

  const specLoose = normalizeLooseTopic(spec);
  const promptLoose = normalizeLooseTopic(prompt);
  if (specLoose === promptLoose) {
    return prompt;
  }
  if (prompt.startsWith(spec) || promptLoose.startsWith(specLoose)) {
    return prompt.length >= spec.length ? prompt : spec;
  }
  if (spec.startsWith(prompt) || specLoose.startsWith(promptLoose)) {
    return spec.length >= prompt.length ? spec : prompt;
  }
  return prompt;
};

export async function executeCreateComponent(
  args: CreateComponentArgs,
  deps: ExecuteCreateComponentDeps,
): Promise<Record<string, unknown>> {
  const findIntentByMessage =
    deps.findIntentByMessage ??
    deps.findLedgerEntryByMessage ??
    (() => undefined);
  const registerIntentEntry =
    deps.registerIntentEntry ??
    deps.registerLedgerEntry ??
    (() => undefined);

  const componentType = String(args.type || '').trim();
  if (!componentType) {
    return { status: 'ERROR', message: 'create_component requires type' };
  }

  const normalizedType = componentType.toLowerCase();
  if (normalizedType === 'airesponse') {
    const roomName = deps.roomName || '';
    if (!roomName) {
      return { status: 'ERROR', message: 'canvas room unavailable' };
    }

    const candidateTexts: Array<string | undefined> = [];
    if (args.props && typeof args.props === 'object') {
      const propsRecord = args.props as Record<string, unknown>;
      if (typeof propsRecord.text === 'string') candidateTexts.push(propsRecord.text);
      if (typeof propsRecord.content === 'string') candidateTexts.push(propsRecord.content);
      if (typeof propsRecord.label === 'string') candidateTexts.push(propsRecord.label);
    }
    if (args.spec && typeof args.spec === 'object') {
      const specRecord = args.spec as Record<string, unknown>;
      if (typeof specRecord.text === 'string') candidateTexts.push(specRecord.text);
      if (typeof specRecord.content === 'string') candidateTexts.push(specRecord.content);
    }
    if (typeof args.spec === 'string') candidateTexts.push(args.spec);

    const text = candidateTexts.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
    if (!text) {
      return { status: 'ERROR', message: 'AIResponse requires text content' };
    }

    const explicitMessageId = typeof args.messageId === 'string' && args.messageId.trim().length > 0
      ? args.messageId.trim()
      : '';
    const requestId = explicitMessageId || randomUUID();
    const quickTextParams: JsonObject = {
      room: roomName,
      text,
      requestId,
    };
    if (args.props && typeof args.props === 'object') {
      const propsRecord = args.props as Record<string, unknown>;
      if (typeof propsRecord.x === 'number' && Number.isFinite(propsRecord.x)) {
        quickTextParams.x = propsRecord.x;
      }
      if (typeof propsRecord.y === 'number' && Number.isFinite(propsRecord.y)) {
        quickTextParams.y = propsRecord.y;
      }
      const boundsCandidate = propsRecord.bounds;
      if (
        boundsCandidate &&
        typeof boundsCandidate === 'object' &&
        typeof (boundsCandidate as any).x === 'number' &&
        typeof (boundsCandidate as any).y === 'number' &&
        typeof (boundsCandidate as any).w === 'number' &&
        typeof (boundsCandidate as any).h === 'number'
      ) {
        quickTextParams.bounds = {
          x: (boundsCandidate as any).x,
          y: (boundsCandidate as any).y,
          w: (boundsCandidate as any).w,
          h: (boundsCandidate as any).h,
        } as JsonObject;
      }
      if (propsRecord.metadata && typeof propsRecord.metadata === 'object' && !Array.isArray(propsRecord.metadata)) {
        quickTextParams.metadata = propsRecord.metadata as JsonObject;
      }
    }

    await deps.sendToolCall('dispatch_to_conductor', {
      task: 'canvas.quick_text',
      params: quickTextParams,
    });

    return { status: 'queued', messageId: requestId };
  }

  const specInput = args.spec === null ? undefined : args.spec;
  const propsInput = args.props === null ? undefined : args.props;
  const normalizedSpec = normalizeSpecInput(specInput);
  const initialProps = normalizeSpecInput(propsInput);
  let mergedProps: JsonObject = {
    ...normalizedSpec,
    ...initialProps,
  };

  let seededScorecardState: JsonObject | null = null;
  let seededScorecardTopic: string | undefined;

  if (componentType === 'RetroTimerEnhanced' || componentType === 'RetroTimer') {
    mergedProps = normalizeTimerCreateProps(mergedProps, deps.lastUserPrompt);
  }

  const now = Date.now();
  const explicitMessageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
  const explicitIntentId = typeof args.intentId === 'string' ? args.intentId.trim() : '';
  const hasExplicitMessageId = explicitMessageId.length > 0;
  const hasExplicitIntentId = explicitIntentId.length > 0;
  const useExplicitIds = hasExplicitMessageId && hasExplicitIntentId;
  const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
  const isDebateScorecard = componentType === 'DebateScorecard';
  const isBareScorecardRequest = isDebateScorecard && Object.keys(mergedProps).length === 0;
  let preseededScorecardId: string | undefined;
  let preseededScorecardIntent: string | undefined;

  if (
    isBareScorecardRequest &&
    !hasExplicitMessageId &&
    !hasExplicitIntentId &&
    deps.lastScorecardProvisionedAt > 0 &&
    now - deps.lastScorecardProvisionedAt < deps.scorecardSuppressWindowMs
  ) {
    const latestScorecard = deps.findLatestScorecardEntryInRoom();
    preseededScorecardId =
      deps.activeScorecard?.componentId ||
      deps.getLastComponentForType('DebateScorecard') ||
      latestScorecard?.id;
    if (preseededScorecardId) {
      const ledger = findIntentByMessage(preseededScorecardId);
      preseededScorecardIntent = ledger?.intentId || deps.activeScorecard?.intentId || undefined;
      console.log('[VoiceAgent] reusing pre-seeded DebateScorecard for create_component call', {
        componentId: preseededScorecardId,
      });
    }
  }

  if (isDebateScorecard && !preseededScorecardId) {
    const topicFromSpec =
      typeof (mergedProps as { topic?: unknown }).topic === 'string'
        ? String((mergedProps as { topic?: unknown }).topic).trim()
        : undefined;
    const topicFromPrompt = inferScorecardTopicFromText(deps.lastUserPrompt ?? undefined);

    seededScorecardTopic =
      pickScorecardTopic(topicFromSpec, topicFromPrompt) ?? topicFromSpec ?? topicFromPrompt ?? 'Live Debate';

    const seed = createDefaultScorecardState(seededScorecardTopic);
    const playersSeed = resolveDebatePlayerSeedFromLabels(deps.listRemoteParticipantLabels());
    try {
      if (Array.isArray((seed as { players?: unknown[] }).players)) {
        for (const update of playersSeed) {
          const players = (seed as { players: Array<{ side?: string; label?: string }> }).players;
          const idx = players.findIndex((player) => player?.side === update.side);
          if (idx === -1) continue;
          players[idx] = { ...players[idx], label: update.label };
        }
      }
    } catch {
      // Preserve create_component behavior: seeding is best effort.
    }
    seededScorecardState = seed as unknown as JsonObject;
    mergedProps = {
      ...(seed as unknown as JsonObject),
      ...mergedProps,
      topic: seededScorecardTopic,
      players: (seed as { players?: unknown[] }).players as unknown as JsonObject['players'],
    } as JsonObject;
  }

  const { intentId: autoIntentId, messageId: autoMessageId } = deriveComponentIntent({
    roomName: deps.roomName || '',
    turnId: deps.currentTurnId,
    componentType,
    spec: mergedProps,
    slot,
  });

  let intentId = useExplicitIds ? explicitIntentId : preseededScorecardIntent ?? autoIntentId;
  let messageId = preseededScorecardId ?? (useExplicitIds ? explicitMessageId : autoMessageId);

  const existingByMessageId = deps.getComponentEntry(messageId);
  if (existingByMessageId && existingByMessageId.type !== componentType) {
    console.warn('[VoiceAgent] messageId collision across component types; generating fresh IDs', {
      messageId,
      componentType,
      existingType: existingByMessageId.type,
    });
    intentId = `intent-${randomUUID()}`;
    messageId = `ui-${randomUUID()}`;
  }

  const fingerprintPayload = Object.keys(mergedProps)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = mergedProps[key];
      return acc;
    }, {});
  if (slot) {
    fingerprintPayload.__slot = slot;
  }
  fingerprintPayload.__type = componentType;
  const sortedFingerprint = JSON.stringify(fingerprintPayload);
  const recentCreate = deps.getRecentCreateFingerprint(componentType);
  const sameTurnDuplicate =
    !!recentCreate &&
    recentCreate.fingerprint === sortedFingerprint &&
    recentCreate.turnId === deps.currentTurnId;
  const withinGlobalTtl =
    !!recentCreate &&
    recentCreate.fingerprint === sortedFingerprint &&
    now - recentCreate.createdAt < CREATE_COMPONENT_DUPLICATE_TTL_MS;
  const intentMatches = !!recentCreate && recentCreate.intentId === intentId;
  const slotMatches = !slot || !recentCreate ? true : recentCreate.slot === slot;

  if (intentMatches && slotMatches && (sameTurnDuplicate || withinGlobalTtl)) {
    const recentEntry = deps.getComponentEntry(recentCreate.messageId);
    if (!recentEntry || recentEntry.type !== componentType) {
      console.warn('[VoiceAgent] duplicate create fingerprint mismatch; proceeding with create', {
        componentType,
        recentMessageId: recentCreate.messageId,
        recentType: recentEntry?.type,
      });
    } else {
      console.log('[VoiceAgent] suppressing duplicate create_component', {
        componentType,
        recentMessageId: recentCreate.messageId,
      });
      deps.setLastComponentForType(componentType, recentCreate.messageId);
      deps.setLastCreatedComponentId(recentCreate.messageId);
      return { status: 'duplicate_skipped', messageId: recentCreate.messageId };
    }
  }

  const existingComponent = deps.getComponentEntry(messageId);
  if (existingComponent) {
    const fallbackSeconds =
      typeof existingComponent?.props?.configuredDuration === 'number' &&
        Number.isFinite(existingComponent.props.configuredDuration)
        ? (existingComponent.props.configuredDuration as number)
        : 300;
    const normalizedPatch = normalizeComponentPatch(mergedProps, fallbackSeconds);
    if (Object.keys(normalizedPatch).length === 0) {
      console.debug('[VoiceAgent] duplicate create_component with no changes; skipping', {
        messageId,
        componentType,
      });
      return { status: 'duplicate_skipped', messageId };
    }
    console.log('[VoiceAgent] coalescing duplicate create_component into update_component', {
      messageId,
      componentType,
    });
    const updateParams: JsonObject = {
      componentId: messageId,
      patch: normalizedPatch,
    };
    if (intentId) {
      updateParams.intentId = intentId;
    }
    if (slot) {
      updateParams.slot = slot;
    }
    await deps.sendToolCall('update_component', updateParams);
    existingComponent.props = {
      ...existingComponent.props,
      ...mergedProps,
    };
    existingComponent.intentId = intentId;
    if (slot) {
      existingComponent.slot = slot;
    }
    if (intentId) {
      registerIntentEntry({
        intentId,
        messageId,
        componentType,
        slot,
        state: 'updated',
      });
    }
    deps.setLastComponentForType(componentType, messageId);
    deps.setLastCreatedComponentId(messageId);
    deps.setRecentCreateFingerprint(componentType, {
      fingerprint: sortedFingerprint,
      messageId,
      createdAt: now,
      turnId: deps.currentTurnId,
      intentId,
      slot,
    });
    return { status: 'queued', messageId, reusedExisting: true };
  }

  deps.setComponentEntry(messageId, {
    type: componentType,
    createdAt: now,
    props: mergedProps as JsonObject,
    state: {} as JsonObject,
    intentId,
    slot,
    room: deps.roomName || '',
  });
  if (intentId) {
    registerIntentEntry({
      intentId,
      messageId,
      componentType,
      slot,
      state: 'created',
    });
  }
  deps.setLastComponentForType(componentType, messageId);
  deps.setLastCreatedComponentId(messageId);
  deps.setRecentCreateFingerprint(componentType, {
    fingerprint: sortedFingerprint,
    messageId,
    createdAt: now,
    turnId: deps.currentTurnId,
    intentId,
    slot,
  });

  const payload: JsonObject = {
    type: componentType,
    messageId,
    spec: mergedProps as JsonObject,
  };
  if (initialProps && Object.keys(initialProps).length > 0) {
    payload.props = initialProps as JsonObject;
  }
  if (intentId) {
    payload.intentId = intentId;
  }
  if (slot) {
    payload.slot = slot;
  }

  await deps.sendToolCall('create_component', payload);

  if (componentType === 'DebateScorecard') {
    const inferredTopic =
      typeof deps.lastUserPrompt === 'string'
        ? inferScorecardTopicFromText(deps.lastUserPrompt)
        : undefined;
    const topic =
      seededScorecardTopic ||
      (typeof (mergedProps as { topic?: unknown }).topic === 'string'
        ? String((mergedProps as { topic?: unknown }).topic).trim()
        : inferredTopic) ||
      'Live Debate';
    deps.setLastScorecardProvisionedAt?.(now);
    deps.setActiveScorecard({ componentId: messageId, intentId, topic });
    await deps.sendScorecardSeedTask({
      componentId: messageId,
      intentId,
      topic,
      seedState: seededScorecardState ?? (createDefaultScorecardState(topic) as unknown as JsonObject),
    });
  }

  return { status: 'queued', messageId };
}

import { Agent, run } from '@openai/agents';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';
import {
  broadcastAgentPrompt,
  broadcastToolCall,
  type CanvasAgentPromptPayload,
} from '@/lib/agents/shared/supabase-context';
import { activeFlowchartSteward } from '../subagents/flowchart-steward-registry';
import { runCanvasSteward } from '../subagents/canvas-steward';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { resolveIntent, getObject, getString } from './intent-resolver';
import { runDebateScorecardSteward, seedScorecardState } from '@/lib/agents/debate-judge';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { getDebateScorecard, commitDebateScorecard } from '@/lib/agents/shared/supabase-context';
import {
  createDefaultPlayers,
  debateScorecardStateSchema,
  type DebateScorecardState,
  type Claim,
} from '@/lib/agents/debate-scorecard-schema';
import { runSearchSteward } from '@/lib/agents/subagents/search-steward';

dotenvConfig({ path: join(process.cwd(), '.env.local') });

// Thin router: receives dispatch_to_conductor and hands off to stewards
const TASK_LEASE_TTL_MS = Number(process.env.TASK_LEASE_TTL_MS ?? 15_000);
const ROOM_CONCURRENCY = Number(process.env.ROOM_CONCURRENCY ?? 2);
const queue = new AgentTaskQueue();

const CLIENT_CANVAS_AGENT_ENABLED = process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true';
const SERVER_CANVAS_EXECUTION_ENABLED =
  (process.env.CANVAS_STEWARD_SERVER_EXECUTION ?? 'true') === 'true' && !CLIENT_CANVAS_AGENT_ENABLED;

const CanvasAgentPromptSchema = z
  .object({
    room: z.string().min(1, 'room is required'),
    message: z.string().min(1, 'message is required'),
    requestId: z.string().min(1).optional(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })
      .partial({ w: true, h: true })
      .optional(),
    selectionIds: z.array(z.string().min(1)).optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .passthrough();

type CanvasAgentPromptInput = z.infer<typeof CanvasAgentPromptSchema>;

const ScorecardTaskArgs = z
  .object({
    room: z.string().min(1, 'room is required'),
    componentId: z.string().min(1, 'componentId is required'),
    windowMs: z.number().min(1_000).max(600_000).optional(),
    intent: z.string().optional(),
    summary: z.string().optional(),
    prompt: z.string().optional(),
    topic: z.string().optional(),
    players: z
      .array(
        z.object({
          side: z.enum(['AFF', 'NEG']),
          label: z.string().min(1),
          avatarUrl: z.string().optional(),
        }),
      )
      .optional(),
    seedState: jsonObjectSchema.optional(),
    claimId: z.string().optional(),
    claimIds: z.array(z.string().min(1)).optional(),
    claimHint: z.string().optional(),
  })
  .passthrough();

type ScorecardTaskInput = z.infer<typeof ScorecardTaskArgs>;

const SearchTaskArgs = z
  .object({
    room: z.string().min(1, 'room is required'),
    query: z.string().min(3, 'query is required'),
    maxResults: z.number().int().min(1).max(6).optional(),
    includeAnswer: z.boolean().optional(),
    topic: z.string().optional(),
    componentId: z.string().optional(),
  })
  .passthrough();

const SCORECARD_AUTO_FACT_CHECK_ENABLED = (process.env.SCORECARD_AUTO_FACT_CHECK ?? 'true') === 'true';
const SCORECARD_AUTO_FACT_CHECK_MIN_INTERVAL_MS = Number(
  process.env.SCORECARD_AUTO_FACT_CHECK_MIN_INTERVAL_MS ?? 10_000,
);
const SCORECARD_AUTO_FACT_CHECK_MAX_CLAIMS = Number(process.env.SCORECARD_AUTO_FACT_CHECK_MAX_CLAIMS ?? 2);

const scorecardAutoFactCheckLedger = new Map<string, number>();
const scorecardExecutionLocks = new Map<string, Promise<void>>();

async function withScorecardLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = scorecardExecutionLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | null = null;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => next);
  scorecardExecutionLocks.set(key, current);

  await previous;
  try {
    return await fn();
  } finally {
    try {
      release?.();
    } finally {
      if (scorecardExecutionLocks.get(key) === current) {
        scorecardExecutionLocks.delete(key);
      }
    }
  }
}

async function handleCanvasAgentPrompt(rawParams: JsonObject) {
  const parsed: CanvasAgentPromptInput = CanvasAgentPromptSchema.parse(rawParams);
  const requestId = (parsed.requestId || randomUUID()).trim();
  const boundsCandidate = parsed.bounds;
  const payload: CanvasAgentPromptPayload = {
    message: parsed.message.trim(),
    requestId,
    bounds:
      boundsCandidate &&
        typeof boundsCandidate.x === 'number' &&
        typeof boundsCandidate.y === 'number' &&
        typeof boundsCandidate.w === 'number' &&
        typeof boundsCandidate.h === 'number'
        ? {
          x: boundsCandidate.x,
          y: boundsCandidate.y,
          w: boundsCandidate.w,
          h: boundsCandidate.h,
        }
        : undefined,
    selectionIds: parsed.selectionIds,
    metadata: parsed.metadata ?? null,
  };

  await broadcastAgentPrompt({
    room: parsed.room.trim(),
    payload,
  });

  return { status: 'queued', requestId, room: parsed.room.trim(), payload };
}

async function primeFactCheckStatus(params: ScorecardTaskInput) {
  const { room, componentId } = params;
  let latestRecord: { state: DebateScorecardState; version: number; lastUpdated: number } | null = null;
  try {
    const record = await getDebateScorecard(room, componentId);
    latestRecord = record;
    const baseState = record?.state;
    if (!baseState) {
      seedScorecardState(room, componentId, record);
      return;
    }

    const workingState = JSON.parse(JSON.stringify(baseState)) as DebateScorecardState;
    const targets = pickFactCheckTargets(workingState, params);
    if (targets.length === 0) {
      seedScorecardState(room, componentId, record);
      return;
    }

    const timestamp = Date.now();
    let updated = false;
    for (const id of targets) {
      const claim = workingState.claims.find((c) => c.id === id);
      if (!claim) continue;
      if (claim.status !== 'CHECKING') {
        claim.status = 'CHECKING';
        claim.updatedAt = timestamp;
        updated = true;
      }
    }

    const pending = new Set(workingState.status?.pendingVerifications ?? []);
    targets.forEach((id) => pending.add(id));
    const lastActionText = params.summary?.trim()
      ? `Fact check requested: ${params.summary.trim().slice(0, 120)}`
      : `Fact check requested for ${targets.join(', ')}`;

    workingState.status = {
      ...workingState.status,
      pendingVerifications: Array.from(pending),
      lastAction: lastActionText,
    };

    if (!updated) {
      seedScorecardState(room, componentId, record);
      return;
    }

    workingState.timeline = [
      ...workingState.timeline,
      {
        id: `evt-${timestamp}`,
        timestamp,
        text: lastActionText,
        type: 'fact_check',
      },
    ];

    const committed = await commitDebateScorecard(room, componentId, {
      state: workingState,
      prevVersion: record.version,
    });
    latestRecord = committed;
    seedScorecardState(room, componentId, committed);
    await broadcastToolCall({
      room,
      tool: 'update_component',
      params: {
        componentId,
        patch: { ...committed.state, version: committed.version } as unknown as JsonObject,
      },
    });
    console.log('[Conductor] primed fact check status', {
      room,
      componentId,
      claims: targets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Conductor] failed to prime fact check status', {
      room: params.room,
      componentId: params.componentId,
      error: message,
    });
    if (latestRecord) {
      seedScorecardState(params.room, params.componentId, latestRecord);
    }
  }
}

const tokenizeText = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

function scoreTokenOverlap(
  text: string | undefined,
  hintTokens: string[],
  perTokenWeight: number,
  maxWeight: number,
): number {
  if (!text || hintTokens.length === 0) return 0;
  const textTokens = tokenizeText(text);
  if (!textTokens.length) return 0;
  const tokenSet = new Set(textTokens);
  let matches = 0;
  for (const token of hintTokens) {
    if (tokenSet.has(token)) {
      matches += 1;
    }
  }
  if (matches === 0) return 0;
  return Math.min(maxWeight, matches * perTokenWeight);
}

function pickFactCheckTargets(state: DebateScorecardState, params: ScorecardTaskInput): string[] {
  const directIds = new Set<string>();
  if (params.claimId && params.claimId.trim()) {
    directIds.add(params.claimId.trim());
  }
  if (Array.isArray(params.claimIds)) {
    params.claimIds.forEach((id) => {
      if (id && id.trim()) directIds.add(id.trim());
    });
  }

  const hint = (params.claimHint || params.prompt || params.summary || '').toLowerCase().trim();
  const hintTokens = hint ? tokenizeText(hint) : [];
  if (directIds.size === 0 && hint) {
    const scored = state.claims
      .map((claim) => ({ id: claim.id, score: scoreClaimMatch(claim, hint, hintTokens) }))
      .filter((entry) => entry.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    for (const entry of scored) {
      directIds.add(entry.id);
    }
  }

  if (directIds.size === 0 && state.claims.length > 0) {
    const sorted = state.claims.slice().sort((a, b) => {
      const aTime = a.updatedAt ?? a.createdAt ?? 0;
      const bTime = b.updatedAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    });
    directIds.add(sorted[0].id);
  }

  return Array.from(directIds);
}

function scoreClaimMatch(claim: Claim, hint: string, hintTokens: string[]): number {
  let score = 0;
  const target = hint.toLowerCase();
  if (target.includes(claim.id.toLowerCase())) score += 4;
  if (claim.summary && target.includes(claim.summary.toLowerCase())) score += 3;
  else {
    score += scoreTokenOverlap(claim.summary, hintTokens, 0.4, 1.6);
  }
  if (claim.quote) {
    const trimmedQuote = claim.quote.toLowerCase().slice(0, 160);
    if (trimmedQuote && target.includes(trimmedQuote)) score += 2;
    else {
      score += scoreTokenOverlap(claim.quote, hintTokens, 0.3, 1.2);
    }
  }
  if (claim.speaker && target.includes(claim.speaker.toLowerCase())) score += 0.75;
  if (target.includes(claim.side.toLowerCase())) score += 0.75;
  if (claim.speech && target.includes(claim.speech.toLowerCase())) score += 0.5;
  return score;
}

async function maybeEnqueueAutoFactChecks(params: ScorecardTaskInput, taskName: string) {
  if (!SCORECARD_AUTO_FACT_CHECK_ENABLED) return;
  if (taskName === 'scorecard.fact_check') return;
  if (taskName === 'scorecard.seed') return;

  const throttleKey = `${params.room}:${params.componentId}`;
  const now = Date.now();
  const lastAt = scorecardAutoFactCheckLedger.get(throttleKey) ?? 0;
  if (now - lastAt < SCORECARD_AUTO_FACT_CHECK_MIN_INTERVAL_MS) return;

  const record = await getDebateScorecard(params.room, params.componentId);
  const state = record?.state;
  if (!state || state.factCheckEnabled !== true) return;

  const pending = new Set(state.status?.pendingVerifications ?? []);
  const candidates = state.claims
    .filter((claim) => claim.status === 'UNTESTED' && !pending.has(claim.id) && (claim.factChecks?.length ?? 0) === 0)
    .sort((a, b) => {
      const aTime = a.updatedAt ?? a.createdAt ?? 0;
      const bTime = b.updatedAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    })
    .slice(0, Math.max(0, Math.min(3, SCORECARD_AUTO_FACT_CHECK_MAX_CLAIMS)));

  if (candidates.length === 0) return;

  scorecardAutoFactCheckLedger.set(throttleKey, now);

  const hint = params.summary || params.prompt || params.intent || undefined;
  try {
    await primeFactCheckStatus({
      ...params,
      claimIds: candidates.map((c) => c.id),
      claimHint: typeof hint === 'string' && hint.trim() ? hint.trim().slice(0, 240) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Conductor] auto fact-check prime failed', {
      room: params.room,
      componentId: params.componentId,
      error: message,
    });
  }
  await queue.enqueueTask({
    room: params.room,
    task: 'scorecard.fact_check',
    params: {
      room: params.room,
      componentId: params.componentId,
      claimIds: candidates.map((c) => c.id),
      claimHint: typeof hint === 'string' && hint.trim() ? hint.trim().slice(0, 240) : undefined,
    } as unknown as JsonObject,
    dedupeKey: `scorecard.fact_check:auto:${params.componentId}:${candidates.map((c) => c.id).join(',')}`,
    resourceKeys: [`room:${params.room}`, `scorecard:${params.componentId}`],
    priority: 1,
  });

  console.log('[Conductor] auto-enqueued scorecard.fact_check', {
    room: params.room,
    componentId: params.componentId,
    claims: candidates.map((c) => c.id),
  });
}

function isDefaultScorecardTopic(topic: string | undefined | null) {
  const normalized = (topic || '').trim().toLowerCase();
  return normalized.length === 0 || normalized === 'untitled debate' || normalized === 'live debate';
}

function isDefaultPlayerLabel(label: string | undefined | null, side: 'AFF' | 'NEG') {
  const normalized = (label || '').trim().toLowerCase();
  if (!normalized) return true;
  if (side === 'AFF') return normalized === 'affirmative' || normalized === 'aff' || normalized === 'pro';
  return normalized === 'negative' || normalized === 'neg' || normalized === 'con';
}

async function upsertScorecardMeta(parsed: ScorecardTaskInput) {
  const { room, componentId } = parsed;
  const record = await getDebateScorecard(room, componentId);
  const base = record?.state ? JSON.parse(JSON.stringify(record.state)) : null;
  let workingState: DebateScorecardState =
    base && typeof base === 'object'
      ? (base as DebateScorecardState)
      : debateScorecardStateSchema.parse({ componentId });

  const desiredTopic =
    typeof parsed.topic === 'string' && parsed.topic.trim().length > 0 ? parsed.topic.trim() : undefined;

  let changed = false;

  if (parsed.seedState && typeof parsed.seedState === 'object') {
    try {
      const seedCandidate = debateScorecardStateSchema.parse({
        ...(parsed.seedState as JsonObject),
        componentId,
      });
      const safeToSeed =
        record.version === 0 &&
        (workingState.claims?.length ?? 0) === 0 &&
        (workingState.timeline?.length ?? 0) <= 2;
      if (safeToSeed) {
        workingState = seedCandidate;
        changed = true;
      }
    } catch (error) {
      console.warn('[Conductor] scorecard.seed ignored invalid seedState', {
        room,
        componentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!Array.isArray(workingState.players) || workingState.players.length < 2) {
    workingState.players = createDefaultPlayers();
    changed = true;
  }

  if (desiredTopic && (isDefaultScorecardTopic(workingState.topic) || workingState.topic !== desiredTopic)) {
    workingState.topic = desiredTopic;
    changed = true;
  }

  if (Array.isArray(parsed.players) && parsed.players.length > 0) {
    for (const update of parsed.players) {
      const side = update.side;
      const desiredLabel = update.label.trim();
      if (!desiredLabel) continue;
      const idx = workingState.players.findIndex((p) => p.side === side);
      if (idx === -1) continue;
      const current = workingState.players[idx];
      const shouldReplace = isDefaultPlayerLabel(current.label, side) || current.label !== desiredLabel;
      if (shouldReplace) {
        workingState.players[idx] = {
          ...current,
          label: desiredLabel,
          avatarUrl: update.avatarUrl ?? current.avatarUrl,
          lastUpdated: Date.now(),
        };
        changed = true;
      }
    }
  }

  if (!changed) {
    console.log('[Conductor] scorecard meta already up to date', { room, componentId });
    seedScorecardState(room, componentId, record);
    return { status: 'no_change', version: record.version };
  }

  const timestamp = Date.now();
  const lastActionText = [
    desiredTopic ? `Topic: ${desiredTopic}` : null,
    Array.isArray(parsed.players) && parsed.players.length
      ? `Players: ${workingState.players.map((p) => p.label).join(' vs ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  workingState.status = {
    ...workingState.status,
    lastAction: lastActionText || workingState.status?.lastAction,
  };
  workingState.timeline = [
    ...(workingState.timeline ?? []),
    {
      id: `evt-${timestamp}`,
      timestamp,
      text: lastActionText || 'Scorecard metadata updated.',
      type: 'moderation',
    },
  ];

  const committed = await commitDebateScorecard(room, componentId, {
    state: workingState,
    prevVersion: record.version,
  });

  seedScorecardState(room, componentId, committed);
  await broadcastToolCall({
    room,
    tool: 'update_component',
    params: {
      componentId,
      patch: committed.state as JsonObject,
    },
  });

  console.log('[Conductor] scorecard meta committed', { room, componentId, version: committed.version });
  return { status: 'ok', version: committed.version };
}

async function executeTask(taskName: string, params: JsonObject) {
  if (!taskName || taskName === 'auto') {
    const resolution = resolveIntent(params);
    if (resolution) {
      if (resolution.kind === 'tool_call') {
        const room = resolveRoom(params);
        await broadcastToolCall({ room, tool: resolution.tool, params: resolution.params });
        return { status: 'handled', tool: resolution.tool };
      }
      if (resolution.kind === 'task') {
        const nextParams = resolution.params ? { ...params, ...resolution.params } : params;
        return executeTask(resolution.task, nextParams);
      }
    }
    const fallbackParams = params.message
      ? params
      : { ...params, message: resolveIntentText(params) };
    return executeTask('canvas.agent_prompt', fallbackParams);
  }

  if (taskName === 'conductor.dispatch') {
    const nextTask = typeof params?.task === 'string' ? params.task : 'auto';
    const payload = (params?.params as JsonObject) ?? params;
    console.log('[Conductor] dispatch_to_conductor routed', {
      nextTask,
      hasPayload: payload != null,
    });
    return executeTask(nextTask, payload ?? {});
  }

  if (taskName.startsWith('flowchart.')) {
    const result = await run(activeFlowchartSteward, JSON.stringify({ task: taskName, params }));
    return result.finalOutput;
  }

  if (taskName.startsWith('scorecard.')) {
    const parsed = ScorecardTaskArgs.parse(params);
    const useFast = taskName !== 'scorecard.fact_check';

    return withScorecardLock(`${parsed.room}:${parsed.componentId}`, async () => {
      if (taskName === 'scorecard.seed') {
        return { status: 'completed', output: await upsertScorecardMeta(parsed) };
      }
      if (taskName === 'scorecard.fact_check') {
        await primeFactCheckStatus(parsed);
      }
      if (
        taskName !== 'scorecard.seed' &&
        (typeof parsed.topic === 'string' || (Array.isArray(parsed.players) && parsed.players.length > 0))
      ) {
        try {
          await upsertScorecardMeta(parsed);
        } catch (error) {
          console.warn('[Conductor] scorecard meta upsert failed before steward dispatch', {
            room: parsed.room,
            componentId: parsed.componentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      console.log('[Conductor] dispatching scorecard task', {
        taskName,
        room: parsed.room,
        componentId: parsed.componentId,
        intent: parsed.intent ?? taskName,
        useFast,
      });

      const output = useFast
        ? await runDebateScorecardStewardFast({
            room: parsed.room,
            componentId: parsed.componentId,
            intent: parsed.intent ?? taskName,
            summary: parsed.summary,
            prompt: parsed.prompt,
            topic: parsed.topic,
          })
        : await runDebateScorecardSteward({
            room: parsed.room,
            componentId: parsed.componentId,
            windowMs: parsed.windowMs,
            intent: parsed.intent ?? taskName,
            summary: parsed.summary,
            prompt: parsed.prompt,
            topic: parsed.topic,
          });

      console.log('[Conductor] scorecard steward completed', {
        taskName,
        room: parsed.room,
        componentId: parsed.componentId,
        ok: true,
        useFast,
      });

      if (useFast) {
        try {
          await maybeEnqueueAutoFactChecks(parsed, taskName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[Conductor] auto fact-check enqueue failed', {
            room: parsed.room,
            componentId: parsed.componentId,
            error: message,
          });
        }
      }

      return { status: 'completed', output };
    });
  }

  if (taskName.startsWith('search.')) {
    const parsed = SearchTaskArgs.parse(params);
    console.log('[Conductor] dispatching search task', {
      taskName,
      room: parsed.room,
      query: parsed.query,
    });
    const result = await runSearchSteward({ task: taskName, params: parsed as JsonObject });
    if (result.status === 'ok' && result.panel) {
      const targetId = parsed.componentId?.trim() || `ui-research-${Date.now().toString(36)}`;
      if (parsed.componentId) {
        await broadcastToolCall({
          room: parsed.room,
          tool: 'update_component',
          params: {
            componentId: targetId,
            patch: result.panel as JsonObject,
          },
        });
      } else {
        await broadcastToolCall({
          room: parsed.room,
          tool: 'create_component',
          params: {
            type: 'ResearchPanel',
            messageId: targetId,
            spec: result.panel as JsonObject,
          },
        });
      }
      console.log('[Conductor] search steward results broadcast', {
        room: parsed.room,
        componentId: targetId,
        hits: result.bundle?.hits?.length ?? 0,
      });
    }
    return {
      status: result.status,
      output: (result.bundle as JsonObject | null) ?? null,
      error: result.error ?? null,
    };
  }

  if (taskName === 'canvas.agent_prompt') {
    const promptResult = await handleCanvasAgentPrompt(params);
    const stewardParams: JsonObject = {
      room: promptResult.room,
      message: promptResult.payload.message,
      requestId: promptResult.payload.requestId,
    };
    if (promptResult.payload.metadata) {
      stewardParams.metadata = promptResult.payload.metadata;
    }
    if (promptResult.payload.bounds) {
      stewardParams.bounds = promptResult.payload.bounds;
    }
    if (promptResult.payload.selectionIds) {
      stewardParams.selectionIds = promptResult.payload.selectionIds;
    }
    if (SERVER_CANVAS_EXECUTION_ENABLED) {
      // Execute via Canvas Steward on the server to ensure action even without the legacy client host
      await runCanvasSteward({ task: 'canvas.agent_prompt', params: stewardParams });
    } else {
      console.log('[Conductor] server canvas steward skipped (client legacy flag enabled)');
    }
    return { ...promptResult, status: 'queued' };
  }

  if (taskName.startsWith('canvas.')) {
    if (!SERVER_CANVAS_EXECUTION_ENABLED) {
      console.log('[Conductor] server canvas steward disabled, skipping task', { taskName });
      return { status: 'skipped', taskName };
    }
    return runCanvasSteward({ task: taskName, params });
  }

  throw new Error(`No steward for task: ${taskName}`);
}

function resolveRoom(params: JsonObject): string {
  const direct = getString(params, 'room');
  if (direct) return direct;
  const metadata = getObject(params, 'metadata');
  const metaRoom = metadata ? getString(metadata, 'room') : undefined;
  if (metaRoom) return metaRoom;
  const participants = params.participants;
  if (typeof participants === 'string') {
    const trimmed = participants.trim();
    if (trimmed) return trimmed;
  }
  if (Array.isArray(participants)) {
    for (const entry of participants) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed) return trimmed;
      }
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const candidate = (entry as JsonObject).room;
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }
  throw new Error('Room is required for conductor execution');
}

function resolveIntentText(params: JsonObject): string {
  const transcript = getString(params, 'transcript');
  if (transcript) return transcript;
  const metadata = getObject(params, 'metadata');
  const metaMessage = metadata ? getString(metadata, 'message') : undefined;
  if (metaMessage) return metaMessage;
  const intent = getString(params, 'intent');
  if (intent) return intent;
  const message = getString(params, 'message');
  if (message) return message;
  return 'Please assist on the canvas';
}

function createLeaseExtender(taskId: string, leaseToken: string) {
  const intervalMs = Math.max(1_000, Math.floor(TASK_LEASE_TTL_MS * 0.6));
  let stopped = false;

  const intervalId = setInterval(() => {
    if (stopped) return;
    void queue.extendLease(taskId, leaseToken, TASK_LEASE_TTL_MS).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Conductor] failed to extend lease', { taskId, error: message });
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

async function workerLoop() {
  while (true) {
    const { leaseToken, tasks } = await queue.claimTasks({
      limit: Number(process.env.TASK_DEFAULT_CONCURRENCY ?? 10),
      leaseTtlMs: TASK_LEASE_TTL_MS,
    });

    if (tasks.length === 0) {
      await delay(500);
      continue;
    }

    console.log('[Conductor] claimed tasks', {
      count: tasks.length,
      taskNames: tasks.map((task) => task.task),
    });

    const roomBuckets = tasks.reduce<Record<string, typeof tasks>>((acc, task) => {
      const roomKey = task.resource_keys.find((key) => key.startsWith('room:')) || 'room:default';
      if (!acc[roomKey]) acc[roomKey] = [];
      acc[roomKey].push(task);
      return acc;
    }, {});

    await Promise.allSettled(
      Object.entries(roomBuckets).map(async ([roomKey, roomTasks]) => {
        const concurrency = ROOM_CONCURRENCY;
        const queueList = [...roomTasks];
        const workers = Array.from({ length: concurrency }).map(async () => {
          while (queueList.length > 0) {
            const task = queueList.shift();
            if (!task) break;
            const stopLeaseExtender = createLeaseExtender(task.id, leaseToken);
            try {
              const startedAt = Date.now();
              const result = await executeTask(task.task, task.params);
              await queue.completeTask(task.id, leaseToken, result as JsonObject);
              const durationMs = Date.now() - startedAt;
              console.log('[Conductor] task completed', { roomKey, taskId: task.id, durationMs });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const retryAt = task.attempt < 3 ? new Date(Date.now() + Math.pow(2, task.attempt) * 1000) : undefined;
              console.warn('[Conductor] task failed', { roomKey, taskId: task.id, task: task.task, attempt: task.attempt, retryAt, error: message });
              await queue.failTask(task.id, leaseToken, { error: message, retryAt });
            } finally {
              stopLeaseExtender();
            }
          }
        });
        await Promise.allSettled(workers);
      }),
    );
  }
}

// Keep the worker alive even if a transient fetch/network error occurs.
async function startWorkerLoop() {
  for (;;) {
    try {
      await workerLoop();
    } catch (err) {
      console.error('[Conductor] worker failed', err);
      // Small backoff before retrying to avoid hot loops on persistent outages.
      await delay(2_000);
    }
  }
}

void startWorkerLoop();

export const conductor = new Agent({
  name: 'Conductor',
  model: 'gpt-5-mini',
  instructions: 'Queue-driven conductor. See worker loop for logic.',
  tools: [],
});

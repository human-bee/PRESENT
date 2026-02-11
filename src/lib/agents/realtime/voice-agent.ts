import { defineAgent, JobContext, cli, WorkerOptions, llm, voice } from '@livekit/agents';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { z } from 'zod';
// Removed temporary Responses API fallback for routing

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch { }
import { realtime as openaiRealtime } from '@livekit/agents-plugin-openai';
import { MultiParticipantTranscriptionManager } from './multi-participant-transcription';
import { appendTranscriptCache, getTranscriptWindow, listCanvasComponents } from '@/lib/agents/shared/supabase-context';
import { buildVoiceAgentInstructions } from '@/lib/agents/instructions';
import { queryCapabilities, defaultCapabilities } from '@/lib/agents/capabilities';
import { deriveComponentIntent } from '@/lib/agents/shared/deterministic-ids';
import type { JsonObject } from '@/lib/utils/json-schema';
import { ConnectionState, RoomEvent, RemoteTrackPublication, Track } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { createManualInputRouter } from './voice-agent/manual-routing';
import { VoiceComponentLedger } from './voice-agent/component-ledger';
import { ScorecardService } from './voice-agent/scorecard-service';
import { TranscriptionBuffer, type PendingTranscriptionMessage } from './voice-agent/transcription-buffer';
import {
  executeCreateComponent,
  type ComponentRegistryEntry,
} from './voice-agent/create-component';
import { createToolParametersSchema } from './voice-agent/tool-context';
import {
  buildToolEvent,
  CANVAS_DISPATCH_SUPPRESS_MS,
  coerceComponentPatch,
  flushPendingToolCallQueue,
  normalizeComponentPatch,
  normalizeSpecInput,
  shouldSuppressCanvasDispatch,
  shouldForceReliableUpdate,
  type PendingToolCallEntry,
  type ToolEvent,
} from './voice-agent/tool-publishing';
import { inferScorecardTopicFromText, resolveDebatePlayerSeedFromLabels } from './voice-agent/scorecard';

const RATE_LIMIT_HEADER_KEYS = [
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-request-id',
];

const readHeaderValue = (headers: unknown, key: string): string | undefined => {
  if (!headers) return undefined;
  try {
    if (typeof (headers as Headers).get === 'function') {
      const direct = (headers as Headers).get(key);
      if (direct && String(direct).trim()) return String(direct);
      const lower = (headers as Headers).get(key.toLowerCase());
      return lower && String(lower).trim() ? String(lower) : undefined;
    }
  } catch { }
  if (typeof headers === 'object' && headers !== null) {
    const candidate = (headers as Record<string, unknown>)[key] ?? (headers as Record<string, unknown>)[key.toLowerCase()];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (typeof candidate === 'number') return candidate.toString();
    if (Array.isArray(candidate) && candidate.length > 0) {
      const first = candidate.find((entry) => typeof entry === 'string' && entry.trim());
      if (first && typeof first === 'string') return first;
    }
  }
  return undefined;
};

const routeManualInput = createManualInputRouter();

const extractRateLimitHeaders = (headers: unknown) => {
  const info: Record<string, string> = {};
  for (const key of RATE_LIMIT_HEADER_KEYS) {
    const value = readHeaderValue(headers, key);
    if (value) {
      info[key] = value;
    }
  }
  return Object.keys(info).length ? info : undefined;
};

const logRealtimeError = (context: string, error: unknown) => {
  if (!error) {
    console.error(`[VoiceAgent] ${context}`, { message: 'Unknown error' });
    return;
  }
  const payload: Record<string, unknown> = { context };
  if (error instanceof Error) {
    payload.message = error.message;
    payload.name = error.name;
  } else if (typeof error === 'string') {
    payload.message = error;
  } else {
    const directMessage = (error as { message?: unknown })?.message;
    if (typeof directMessage === 'string' && directMessage.trim()) {
      payload.message = directMessage;
    } else {
      try {
        payload.message = JSON.stringify(error);
      } catch {
        payload.message = String(error);
      }
    }
  }
  const status = (error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  if (typeof status !== 'undefined') payload.status = status;
  const code = (error as { code?: string | number; errorCode?: string | number })?.code ?? (error as { errorCode?: string | number })?.errorCode;
  if (typeof code !== 'undefined') payload.code = code;
  const responseData = (error as { response?: { data?: Record<string, unknown>; headers?: unknown } })?.response?.data ?? (error as { data?: Record<string, unknown> })?.data;
  if (responseData && typeof responseData === 'object') {
    const detailPayload: Record<string, unknown> = {};
    const detailMessage = (responseData as { message?: string }).message;
    if (detailMessage) detailPayload.message = detailMessage;
    const detailType = (responseData as { type?: string }).type;
    if (detailType) detailPayload.type = detailType;
    const detailCode = (responseData as { code?: string }).code;
    if (detailCode) detailPayload.detailCode = detailCode;
    if (Object.keys(detailPayload).length > 0) {
      payload.detail = detailPayload;
    }
  }
  const headers = (error as { response?: { headers?: unknown } })?.response?.headers ?? (error as { headers?: unknown })?.headers;
  const rateLimit = extractRateLimitHeaders(headers);
  if (rateLimit) {
    payload.rateLimit = rateLimit;
  }
  const stack = (error as Error)?.stack;
  if (stack) {
    payload.stack = stack.split('\n').slice(0, 5).join('\n');
  }
  console.error('[VoiceAgent] realtime error', payload);
};

// Prevent dev worker from crashing on transient websocket/library errors.
// In production we generally prefer crashing fast, but the local demo stack benefits from resilience.
const GLOBAL_VOICE_AGENT_GUARD_KEY = '__present_voice_agent_global_error_guard__';
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[GLOBAL_VOICE_AGENT_GUARD_KEY]) {
  globalAny[GLOBAL_VOICE_AGENT_GUARD_KEY] = true;
  const swallowFatal =
    process.env.VOICE_AGENT_SWALLOW_FATAL_ERRORS !== 'false' &&
    process.env.NODE_ENV !== 'production';

  process.on('uncaughtException', (err) => {
    logRealtimeError('uncaughtException', err);
    if (!swallowFatal) process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logRealtimeError('unhandledRejection', reason);
    if (!swallowFatal) process.exit(1);
  });
}

export default defineAgent({
  entry: async (job: JobContext) => {
    try {
      await job.connect();
    } catch (error) {
      logRealtimeError('failed to connect to LiveKit room', error);
      throw error;
    }
    console.log('[VoiceAgent] Connected to room:', job.room.name);
    const liveKitBus = createLiveKitBus(job.room);
    const allowSensitiveLogging = process.env.NODE_ENV !== 'production';

    // Data messages (topic: "transcription") can arrive immediately after the agent joins the room.
    // Attach the listener up-front and buffer until the realtime session is running so we don't drop early turns.
    const transcriptionBuffer = new TranscriptionBuffer(64, 30_000);
    let transcriptionProcessingEnabled = false;
    let handleBufferedTranscription:
      | ((message: PendingTranscriptionMessage) => Promise<void>)
      | null = null;

    const drainPendingTranscriptions = async () => {
      if (!transcriptionProcessingEnabled || !handleBufferedTranscription) return;
      transcriptionBuffer.setEnabled(true);
      await transcriptionBuffer.drain(
        handleBufferedTranscription,
        (error) => logRealtimeError('failed to handle buffered transcription', error),
      );
    };

    const ingestTranscription = (message: {
      text: string;
      speaker?: string;
      participantId?: string;
      participantName?: string;
      isManual?: boolean;
      isFinal?: boolean;
      timestamp?: number;
      serverGenerated?: boolean;
    }) => {
      const text = typeof message?.text === 'string' ? message.text.trim() : '';
      if (!text) return;

      const isManual = Boolean(message?.isManual);
      const isFinal = message?.isFinal ?? true;
      if (!isFinal) return;

      const participantIdRaw =
        typeof message?.participantId === 'string' ? message.participantId.trim() : '';
      const participantNameRaw =
        typeof message?.participantName === 'string' ? message.participantName.trim() : '';
      const speakerRaw = typeof message?.speaker === 'string' ? message.speaker.trim() : '';

      const speaker = participantNameRaw || speakerRaw || participantIdRaw || undefined;
      const participantId = participantIdRaw || undefined;
      const participantName =
        participantNameRaw ||
        (speakerRaw && speakerRaw !== participantIdRaw ? speakerRaw : undefined) ||
        undefined;

      if (!isManual) {
        const lower = String(speaker || '').toLowerCase();
        if (lower.includes('voice-agent') || lower.startsWith('agent-')) return;
      }

      const entry: PendingTranscriptionMessage = {
        text,
        speaker,
        participantId,
        participantName,
        isManual,
        isFinal,
        timestamp: typeof message?.timestamp === 'number' ? message.timestamp : undefined,
        serverGenerated: Boolean(message?.serverGenerated),
        receivedAt: Date.now(),
      };

      if (!transcriptionProcessingEnabled || !handleBufferedTranscription) {
        transcriptionBuffer.enqueue(entry);
        return;
      }

      void handleBufferedTranscription(entry)
        .then(() => { })
        .catch((error) => logRealtimeError('failed to handle transcription', error));
    };

    job.room.on(RoomEvent.DataReceived, (payload, participant, _, topic) => {
      if (topic !== 'transcription') return;
      let message: any;
      try {
        message = JSON.parse(new TextDecoder().decode(payload));
      } catch (error) {
        logRealtimeError('failed to parse data payload', error);
        return;
      }

      const text = typeof message?.text === 'string' ? message.text.trim() : '';
      const isReplay = Boolean(message?.replay);
      const isManual = Boolean(message?.manual);
      const isFinal =
        typeof message?.is_final === 'boolean'
          ? message.is_final
          : typeof message?.isFinal === 'boolean'
            ? message.isFinal
            : typeof message?.final === 'boolean'
              ? message.final
              : true;
      const participantId = typeof message?.participantId === 'string' ? message.participantId : participant?.identity;
      const speaker = typeof message?.speaker === 'string' ? message.speaker : participant?.name || participant?.identity;

      if (!text || isReplay) return;
      ingestTranscription({
        text,
        speaker: typeof speaker === 'string' ? speaker : undefined,
        participantId: typeof participantId === 'string' ? participantId : undefined,
        participantName: typeof speaker === 'string' ? speaker : undefined,
        isManual,
        isFinal,
        timestamp: typeof message?.timestamp === 'number' ? message.timestamp : undefined,
        serverGenerated: Boolean(message?.server_generated),
      });
    });

    const coerceBooleanFromEnv = (value?: string | null) => {
      if (!value) return undefined;
      const normalized = value.trim().toLowerCase();
      if (!normalized) return undefined;
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      return undefined;
    };

    const envInputTranscriptionModel = process.env.VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL?.trim();
    const fallbackInputTranscriptionModel = process.env.AGENT_STT_MODEL?.trim();
    const envSttModel = process.env.VOICE_AGENT_STT_MODEL?.trim();
    const envTranscriptionLanguage = process.env.VOICE_AGENT_TRANSCRIPTION_LANGUAGE?.trim();
    const fallbackTranscriptionLanguage = process.env.AGENT_STT_LANGUAGE?.trim();
    const resolvedInputTranscriptionModel = envInputTranscriptionModel || fallbackInputTranscriptionModel || undefined;
    const resolvedSttModel = envSttModel || resolvedInputTranscriptionModel || 'gpt-4o-mini-transcribe';
    const envTurnDetection = process.env.VOICE_AGENT_TURN_DETECTION?.trim().toLowerCase();
    const transcriptionEnabledFlag = coerceBooleanFromEnv(process.env.VOICE_AGENT_TRANSCRIPTION_ENABLED);
    const multiParticipantTranscriptionEnabled =
      coerceBooleanFromEnv(process.env.VOICE_AGENT_MULTI_PARTICIPANT_TRANSCRIPTION) ??
      false;
    const transcriptionEnabled =
      transcriptionEnabledFlag ?? (!multiParticipantTranscriptionEnabled && Boolean(resolvedInputTranscriptionModel));
    const resolvedTranscriptionLanguage = envTranscriptionLanguage || fallbackTranscriptionLanguage || undefined;
    const inputAudioTranscription = transcriptionEnabled
      ? {
        model: resolvedSttModel,
        ...(resolvedTranscriptionLanguage ? { language: resolvedTranscriptionLanguage } : {}),
      }
      : null;
    const turnDetectionOption = (() => {
      if (!transcriptionEnabled) return null;
      if (!envTurnDetection) return undefined; // fall back to agent default (server VAD)
      if (envTurnDetection === 'none') return null;
      if (envTurnDetection === 'semantic_vad') {
        return { type: 'semantic_vad' as const };
      }
      if (envTurnDetection === 'server_vad') {
        return { type: 'server_vad' as const };
      }
      return undefined;
    })();

    console.log('[VoiceAgent] transcription config', {
      multiParticipantTranscriptionEnabled,
      resolvedSttModel,
      transcriptionEnabled,
      inputAudioTranscription,
      turnDetectionOption,
    });

    const subscribeToParticipant = (participant?: any) => {
      if (!participant) return;

      const publicationMaps: Array<Map<string, RemoteTrackPublication> | undefined> = [
        (participant as any).trackPublications,
        (participant as any).tracks,
      ];

      let subscribed = false;
      for (const map of publicationMaps) {
        if (!map || typeof map.forEach !== 'function') continue;
        map.forEach((publication: any) => {
          if (publication.kind === Track.Kind.Audio && !publication.isSubscribed) {
            try {
              publication.setSubscribed?.(true);
              subscribed = true;
            } catch (error) {
              console.warn('[VoiceAgent] failed to subscribe to audio track', error);
            }
          }
        });
        if (subscribed) return;
      }

      const publications = participant.getTrackPublications?.();
      if (Array.isArray(publications)) {
        publications.forEach((publication: any) => {
          if (publication.kind === Track.Kind.Audio && !publication.isSubscribed) {
            try {
              publication.setSubscribed?.(true);
            } catch (error) {
              console.warn('[VoiceAgent] failed to subscribe to audio track', error);
            }
          }
        });
      }
    };

    job.room.remoteParticipants.forEach((participant) => subscribeToParticipant(participant));
    job.room.on(RoomEvent.ParticipantConnected, (participant) => subscribeToParticipant(participant as any));
    job.room.on(RoomEvent.TrackPublished, (_publication, participant) => subscribeToParticipant(participant as any));

    const transcriptionMaxParticipants = (() => {
      const raw =
        process.env.VOICE_AGENT_TRANSCRIPTION_MAX_PARTICIPANTS ??
        process.env.VOICE_AGENT_TRANSCRIBER_MAX_PARTICIPANTS ??
        '';
      const parsed = raw ? Number(raw) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) return 8;
      return Math.max(1, Math.min(16, Math.floor(parsed)));
    })();

    let multiParticipantTranscriber: MultiParticipantTranscriptionManager | null = null;
    if (multiParticipantTranscriptionEnabled) {
      multiParticipantTranscriber = new MultiParticipantTranscriptionManager({
        room: job.room as any,
        maxParticipants: transcriptionMaxParticipants,
        model: resolvedSttModel,
        language: resolvedTranscriptionLanguage,
        onTranscript: (payload) => {
          try {
            // Fan out to all browsers for transcript UI.
            job.room.localParticipant?.publishData(
              new TextEncoder().encode(JSON.stringify(payload)),
              {
                reliable: payload.is_final,
                topic: 'transcription',
              },
            );
          } catch { }

          // Feed the orchestrator directly (the voice agent does not receive its own data packets).
          ingestTranscription({
            text: payload.text,
            speaker: payload.speaker,
            participantId: payload.participantId,
            participantName: payload.speaker,
            isManual: false,
            isFinal: payload.is_final,
            timestamp: payload.timestamp,
            serverGenerated: true,
          });
        },
      });

      multiParticipantTranscriber.start();
      console.log('[VoiceAgent] multi-participant transcription enabled', {
        maxParticipants: transcriptionMaxParticipants,
        model: resolvedSttModel,
        language: resolvedTranscriptionLanguage,
      });
    }

    let instructions = `You are a UI automation agent. You NEVER speak—you only act by calling tools.

CRITICAL RULES:
1. For canvas work (draw, sticky note, shapes): call dispatch_to_conductor({ task: "canvas.agent_prompt", params: { room: CURRENT_ROOM, message: "<user request>", requestId: "<uuid>", bounds?, selectionIds? } }). Generate a fresh UUID when you create requestId.
2. For component creation/updates: call create_component or update_component.
3. NEVER respond with conversational text. If uncertain, call a tool anyway.
4. Do not greet, explain, or narrate. Tool calls only.

Examples:
- User: "draw a cat" → dispatch_to_conductor({ task: "canvas.agent_prompt", params: { room: CURRENT_ROOM, message: "draw a cat", requestId: "..." } })
- User: "focus on the selected rectangles" → dispatch_to_conductor({ task: "canvas.agent_prompt", params: { room: CURRENT_ROOM, message: "focus on the selected rectangles", requestId: "...", selectionIds: CURRENT_SELECTION_IDS } })
- User: "add a timer" → create_component({ type: "RetroTimerEnhanced", spec: "{}" })
- User: "hi" → (no tool needed, stay silent)

Your only output is function calls. Never use plain text unless absolutely necessary.`;

    const componentRegistry = new Map<string, ComponentRegistryEntry>();
    const roomKey = () => job.room.name || 'room';
    const componentLedger = new VoiceComponentLedger(roomKey);
    let lastResearchPanelId: string | null = null;
    let activeScorecard: { componentId: string; intentId: string; topic: string } | null = null;
    const getLastComponentForType = (type: string) => componentLedger.getLastComponentForType(type);
    const setLastComponentForType = (type: string, messageId: string) => componentLedger.setLastComponentForType(type, messageId);
    const clearLastComponentForType = (type: string, expectedMessageId?: string) =>
      componentLedger.clearLastComponentForType(type, expectedMessageId);

    const rememberResearchPanel = (candidate?: string | null) => {
      if (typeof candidate !== 'string') return;
      const trimmed = candidate.trim();
      if (!trimmed) return;
      lastResearchPanelId = trimmed;
    };


    const buildResearchPlaceholderSpec = (query: string): JsonObject => {
      const trimmed = query.trim();
      const shortened = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
      const spec: JsonObject = {
        title: shortened ? `Research: ${shortened}` : 'Research Results',
        results: [],
        isLive: true,
        showCredibilityFilter: true,
      };
      if (shortened) {
        spec.currentTopic = shortened;
      }
      return spec;
    };

    const ensureResearchPanelProvisioned = async (query: string) => {
      const spec = buildResearchPlaceholderSpec(query);
      const { intentId, messageId } = deriveComponentIntent({
        roomName: job.room.name || '',
        turnId: currentTurnId,
        componentType: 'ResearchPanel',
        spec,
      });
      const existing = getComponentEntry(messageId);
      if (!existing) {
        componentRegistry.set(messageId, {
          type: 'ResearchPanel',
          createdAt: Date.now(),
          props: spec,
          state: {} as JsonObject,
          intentId,
          slot: undefined,
          room: job.room.name || 'room',
        });
      } else {
        existing.intentId = intentId;
        existing.props = { ...existing.props, ...spec };
      }
      if (intentId) {
        registerLedgerEntry({
          intentId,
          messageId,
          componentType: 'ResearchPanel',
          state: existing ? 'updated' : 'created',
        });
      }
      setLastComponentForType('ResearchPanel', messageId);
      setLastCreatedComponentId(messageId);
      rememberResearchPanel(messageId);
      setRecentCreateFingerprint('ResearchPanel', {
        fingerprint: JSON.stringify({ ...spec, __type: 'ResearchPanel' }),
        messageId,
        createdAt: Date.now(),
        turnId: currentTurnId,
        intentId,
      });
      if (!existing) {
        await sendToolCall('create_component', {
          type: 'ResearchPanel',
          messageId,
          intentId,
          spec,
        });
      }
      return { componentId: messageId, intentId };
    };

    const registerLedgerEntry = (entry: {
      intentId: string;
      messageId: string;
      componentType: string;
      slot?: string;
      state?: 'reserved' | 'created' | 'updated';
    }) => componentLedger.registerIntentEntry(entry);

    const findLedgerEntryByMessage = (messageId: string) => {
      componentLedger.cleanupExpired();
      return componentLedger.findIntentByMessage(messageId);
    };

    const hydrateComponentsFromCanvas = async () => {
      const roomName = job.room.name || '';
      if (!roomName) return;
      try {
        const snapshot = await listCanvasComponents(roomName);
        if (!Array.isArray(snapshot)) return;
        console.log('[VoiceAgent] loaded canvas component snapshot', {
          room: roomName,
          total: snapshot.length,
        });
        if (snapshot.length === 0) return;
        const restored: Array<{ componentId: string; componentType: string; lastUpdated?: number | null; intentId?: string | null; state?: JsonObject | null; props: JsonObject }> = [];
        for (const entry of snapshot) {
          if (!entry?.componentId) continue;
          if (componentRegistry.has(entry.componentId)) continue;
          const componentType = entry.componentType?.trim() || 'unknown';
          if (!componentType || componentType === 'unknown') continue;
          const safeProps = entry.props && typeof entry.props === 'object' ? (entry.props as JsonObject) : {};
          const safeState = entry.state && typeof entry.state === 'object' ? (entry.state as JsonObject) : null;
          const intentId = entry.intentId?.trim() || (typeof safeProps.intentId === 'string' ? (safeProps.intentId as string) : undefined);
          componentRegistry.set(entry.componentId, {
            type: componentType,
            createdAt: entry.lastUpdated ?? Date.now(),
            props: safeProps,
            state: safeState ?? safeProps,
            intentId,
            room: roomName,
          });
          if (intentId) {
            registerLedgerEntry({ intentId, messageId: entry.componentId, componentType, state: 'updated' });
          }
          setLastComponentForType(componentType, entry.componentId);
          restored.push(entry);
        }

        const existingScorecard = restored
          .filter((item) => item.componentType === 'DebateScorecard')
          .sort((a, b) => (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0))[0];
        if (existingScorecard) {
          const state = existingScorecard.state || existingScorecard.props;
          const topic =
            (state && typeof state.topic === 'string' && state.topic.trim())
              ? state.topic.trim()
              : (typeof existingScorecard.props?.topic === 'string' && existingScorecard.props.topic.trim())
                ? (existingScorecard.props.topic as string).trim()
                : 'Live Debate';
          const resolvedIntentId =
            existingScorecard.intentId?.trim() || `debate-scorecard-${existingScorecard.componentId}`;
          activeScorecard = {
            componentId: existingScorecard.componentId,
            intentId: resolvedIntentId,
            topic,
          };
          registerLedgerEntry({
            intentId: resolvedIntentId,
            messageId: existingScorecard.componentId,
            componentType: 'DebateScorecard',
            state: 'updated',
          });
          setLastComponentForType('DebateScorecard', existingScorecard.componentId);
        }

        if (restored.length > 0) {
          console.log('[VoiceAgent] hydrated component registry from canvas', {
            room: roomName,
            restored: restored.length,
            hasDebateScorecard: Boolean(existingScorecard),
          });
        }
      } catch (error) {
        console.warn('[VoiceAgent] failed to hydrate components from canvas', error);
      }
    };

    await hydrateComponentsFromCanvas();
    const requestComponentSnapshot = () => {
      try {
        const payload = {
          type: 'component_snapshot_request',
          room: job.room.name || '',
          timestamp: Date.now(),
        };
        job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          reliable: true,
          topic: 'component_snapshot_request',
        });
      } catch (error) {
        console.warn('[VoiceAgent] failed to request component snapshot', error);
      }
    };

    const applyComponentSnapshotMessage = (message: any) => {
      const entries = Array.isArray(message?.components) ? message.components : [];
      if (!entries || entries.length === 0) return;
      let restoredScorecard = false;
      for (const entry of entries) {
        const componentId = typeof entry?.componentId === 'string' ? entry.componentId.trim() : '';
        if (!componentId) continue;
        const componentType =
          typeof entry.componentType === 'string' && entry.componentType.trim()
            ? entry.componentType.trim()
            : 'unknown';
        const props = entry.props && typeof entry.props === 'object' ? (entry.props as JsonObject) : {};
        const state = entry.state && typeof entry.state === 'object' ? (entry.state as JsonObject) : props;
        const intentId =
          typeof entry.intentId === 'string' && entry.intentId.trim().length > 0
            ? entry.intentId.trim()
            : undefined;
        componentRegistry.set(componentId, {
          type: componentType,
          createdAt: typeof entry.lastUpdated === 'number' ? entry.lastUpdated : Date.now(),
          props,
          state,
          intentId,
          room: job.room.name || '',
        });
        setLastComponentForType(componentType, componentId);
        if (intentId) {
          registerLedgerEntry({
            intentId,
            messageId: componentId,
            componentType,
            state: 'updated',
          });
        }
        if (componentType === 'DebateScorecard') {
          const topicCandidate =
            (state?.topic && typeof state.topic === 'string' && state.topic.trim())
              ? state.topic.trim()
              : (props?.topic && typeof props.topic === 'string' && props.topic.trim())
                ? (props.topic as string).trim()
                : 'Live Debate';
          const resolvedIntentId = intentId ?? `debate-scorecard-${componentId}`;
          activeScorecard = {
            componentId,
            intentId: resolvedIntentId,
            topic: topicCandidate,
          };
          restoredScorecard = true;
        }
      }
      if (restoredScorecard) {
        console.log('[VoiceAgent] restored DebateScorecard via component_snapshot');
      }
    };

    liveKitBus.on('component_snapshot', (message: unknown) => {
      try {
        applyComponentSnapshotMessage(message);
      } catch (error) {
        console.warn('[VoiceAgent] failed to apply component_snapshot via bus', error);
      }
    });

    requestComponentSnapshot();

    const SCORECARD_SUPPRESS_WINDOW_MS = 10_000;
    // Duplicate suppression across turns: track last create by component type.
    // We suppress duplicates aggressively within the same user turn, and apply
    // a longer global TTL to catch late replays from the model/stack.
    let currentTurnId = 0;
    let isGeneratingReply = false;
    let lastScorecardProvisionedAt = 0;

    const listRemoteParticipantLabels = (): string[] => {
      const labels: string[] = [];
      try {
        job.room.remoteParticipants.forEach((participant: any) => {
          const candidate = String(participant?.name || participant?.identity || '').trim();
          if (!candidate) return;
          labels.push(candidate);
        });
      } catch {
        /* noop */
      }
      const seen = new Set<string>();
      return labels.filter((label) => {
        const key = label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const sendScorecardSeedTask = async (payload: {
      componentId: string;
      intentId?: string;
      topic?: string;
      seedState?: JsonObject;
    }) => {
      const room = roomKey() || job.room?.name || 'room';
      const componentId = payload.componentId.trim();
      if (!componentId) return;
      const players = resolveDebatePlayerSeedFromLabels(listRemoteParticipantLabels());

      await sendToolCall('dispatch_to_conductor', {
        task: 'scorecard.seed',
        params: {
          room,
          componentId,
          players,
          ...(payload.seedState ? { seedState: payload.seedState } : {}),
          ...(typeof payload.topic === 'string' && payload.topic.trim().length > 0
            ? { topic: payload.topic.trim() }
            : {}),
          ...(typeof payload.intentId === 'string' && payload.intentId.trim().length > 0
            ? { intent: payload.intentId.trim() }
            : {}),
        },
      });
    };

    const getLastCreatedComponentId = () => componentLedger.getLastCreatedComponentId();
    const setLastCreatedComponentId = (messageId: string | null) => componentLedger.setLastCreatedComponentId(messageId);
    const getRecentCreateFingerprint = (type: string) => componentLedger.getRecentCreateFingerprint(type);
    const setRecentCreateFingerprint = (
      type: string,
      fingerprint: {
        fingerprint: string;
        messageId: string;
        createdAt: number;
        turnId: number;
        intentId: string;
        slot?: string;
      },
    ) => componentLedger.setRecentCreateFingerprint(type, fingerprint);
    const getComponentEntry = (id: string) => {
      const entry = componentRegistry.get(id);
      if (!entry) return undefined;
      const key = roomKey();
      if (entry.room && entry.room !== key) return undefined;
      return entry;
    };
    const setComponentEntry = (id: string, entry: ComponentRegistryEntry) => {
      componentRegistry.set(id, entry);
    };
    const pruneRemovedComponentState = (resolvedId: string, typeHint?: string) => {
      const existing = getComponentEntry(resolvedId);
      const normalizedTypeHint =
        typeof typeHint === 'string' && typeHint.trim().length > 0 ? typeHint.trim() : '';
      const removedType = existing?.type || normalizedTypeHint;

      componentRegistry.delete(resolvedId);

      if (removedType) {
        clearLastComponentForType(removedType, resolvedId);
      }
      if (getLastCreatedComponentId() === resolvedId) {
        setLastCreatedComponentId(null);
      }
      if (removedType === 'ResearchPanel' && lastResearchPanelId === resolvedId) {
        lastResearchPanelId = null;
      }

      componentLedger.clearIntentForMessage(resolvedId);
      return removedType;
    };
    const findLatestScorecardEntryInRoom = () => {
      const key = roomKey();
      let latest: { id: string; entry: ComponentRegistryEntry } | null = null;
      for (const [id, entry] of componentRegistry.entries()) {
        if (entry.type !== 'DebateScorecard') continue;
        if (entry.room && entry.room !== key) continue;
        if (!latest || entry.createdAt > latest.entry.createdAt) {
          latest = { id, entry };
        }
      }
      return latest;
    };

    const resolveComponentId = (args: Record<string, unknown>) => {
      componentLedger.cleanupExpired();
      return componentLedger.resolveComponentId(args, {
        getComponentEntry,
        listComponentEntries: () => componentRegistry.entries(),
        lastResearchPanelId,
        roomKey: roomKey() || job.room?.name || 'room',
      });
    };

    const bumpTurn = () => {
      currentTurnId += 1;
    };

    const enableLossyUpdates = process.env.VOICE_AGENT_UPDATE_LOSSY !== 'false';

    const pendingToolCalls: PendingToolCallEntry[] = [];
    let toolCallListenersAttached = false;
    let flushToolCallsHandle: ReturnType<typeof setTimeout> | null = null;

    const publishToolCall = async (entry: { event: ToolEvent; reliable: boolean }) => {
      const participant = job.room.localParticipant;
      if (!participant) {
        console.info('[VoiceAgent] deferring tool_call publish; local participant unavailable', {
          tool: entry.event.payload.tool,
        });
        return false;
      }
      const payloadBytes = new TextEncoder().encode(JSON.stringify(entry.event));
      console.debug('[VoiceAgent][debug] publish data', {
        tool: entry.event.payload.tool,
        reliable: entry.reliable,
        roomState: job.room.connectionState,
        participant: participant.identity,
        payloadSize: payloadBytes.byteLength,
      });
      const publishResult = participant.publishData(payloadBytes, {
        reliable: entry.reliable,
        topic: 'tool_call',
      });
      // Add timeout to prevent hanging on publish
      if (publishResult && typeof (publishResult as PromiseLike<unknown>).then === 'function') {
        const timeoutMs = 3000;
        await Promise.race([
          publishResult,
          new Promise((_, reject) => setTimeout(() => reject(new Error('publish timeout')), timeoutMs)),
        ]).catch((err) => {
          console.warn('[VoiceAgent] publishData timed out or failed, continuing anyway', { tool: entry.event.payload.tool, err });
        });
      }
      console.log('[VoiceAgent] tool_call publish complete', {
        tool: entry.event.payload.tool,
        reliable: entry.reliable,
      });
      return true;
    };

    const flushPendingToolCalls = async () => {
      const drained = await flushPendingToolCallQueue({
        queue: pendingToolCalls,
        isConnected: (job.room as any).state === ConnectionState.Connected,
        publish: publishToolCall,
        onPublishError: (error, next) => {
          console.warn('[VoiceAgent] failed to flush pending tool_call, re-queueing', {
            tool: next.event.payload.tool,
            error,
          });
        },
      });
      if (!drained && pendingToolCalls.length > 0 && !flushToolCallsHandle) {
        flushToolCallsHandle = setTimeout(() => {
          flushToolCallsHandle = null;
          void flushPendingToolCalls();
        }, 250);
      }
    };

    const ensureToolCallListeners = () => {
      if (toolCallListenersAttached) return;
      toolCallListenersAttached = true;
      job.room.on(RoomEvent.ConnectionStateChanged, () => {
        void flushPendingToolCalls();
      });
    };

    const normalizeOutgoingParams = (tool: string, params: JsonObject): JsonObject => {
      if (tool === 'update_component') {
        const nextParams: JsonObject = { ...params };
        const componentId =
          typeof nextParams.componentId === 'string' && nextParams.componentId.trim().length > 0
            ? nextParams.componentId.trim()
            : '';
        const existing = componentId ? getComponentEntry(componentId) : undefined;

        const fallbackSeconds =
          typeof existing?.props?.configuredDuration === 'number' &&
            Number.isFinite(existing.props.configuredDuration)
            ? (existing.props.configuredDuration as number)
            : 300;

        const normalizedPatch = normalizeComponentPatch(
          coerceComponentPatch((nextParams as any).patch),
          fallbackSeconds,
        );
        // For instruction-driven widgets, let the client assign timestamps to avoid
        // clock skew causing ComponentRegistry to ignore the update.
        if (typeof (normalizedPatch as any).instruction === 'string') {
          delete (normalizedPatch as any).updatedAt;
          delete (normalizedPatch as any).lastUpdated;
        }

        nextParams.patch = normalizedPatch as JsonObject;
        if (componentId) {
          nextParams.componentId = componentId;
        }
        return nextParams;
      }

      if (tool === 'create_component') {
        if (params && typeof (params as any).spec !== 'undefined') {
          const specRecord = normalizeSpecInput((params as any).spec);
          if (Object.keys(specRecord).length > 0) {
            return { ...params, spec: specRecord as JsonObject };
          }
        }
      }

      return params;
    };

    const recentCanvasDispatches = new Map<string, { ts: number; requestId?: string }>();
    const TOOL_DEDUPE_WINDOW_MS = Math.max(250, Number(process.env.VOICE_AGENT_TOOL_DEDUPE_WINDOW_MS ?? 1_500));
    const EVENT_BUDGET_PER_SEC = Math.max(2, Number(process.env.VOICE_AGENT_EVENT_BUDGET_PER_SEC ?? 24));
    const recentToolCallFingerprints = new Map<string, number>();
    const roomEventBudget = new Map<string, { windowStart: number; events: number }>();

    type IntentGateDecision = {
      allow: boolean;
      confidence: number;
      reason: string;
    };

    type ToolCallFingerprint = {
      key: string;
      ts: number;
    };

    type RoomBudgetState = {
      windowStart: number;
      events: number;
    };

    const canvasIntentKeywords = [
      'draw',
      'canvas',
      'shape',
      'sticky',
      'diagram',
      'layout',
      'align',
      'resize',
      'color',
      'style',
      'place',
      'move',
      'delete',
      'arrow',
      'text',
      'box',
      'circle',
      'flowchart',
    ];

    const evaluateDispatchIntent = (task: string, taskParams: Record<string, unknown>): IntentGateDecision => {
      if (
        (process.env.VOICE_AGENT_ALLOW_INTERNAL_BYPASS ?? 'false') === 'true' &&
        taskParams.__internalBypass === true
      ) {
        return { allow: true, confidence: 1, reason: 'forced' };
      }

      if (task === 'auto') {
        const message = typeof taskParams.message === 'string' ? taskParams.message.trim() : '';
        if (!message) {
          return { allow: false, confidence: 0.1, reason: 'auto dispatch missing message' };
        }
      }

      if (task === 'fairy.intent' || task === 'canvas.agent_prompt' || task === 'auto') {
        const message = typeof taskParams.message === 'string' ? taskParams.message.trim().toLowerCase() : '';
        if (!message || message.length < 2) {
          return { allow: false, confidence: 0.12, reason: 'canvas intent too short' };
        }
        const keywordHits = canvasIntentKeywords.reduce(
          (count, keyword) => (message.includes(keyword) ? count + 1 : count),
          0,
        );
        const confidence = Math.min(0.98, 0.2 + keywordHits * 0.16 + Math.min(message.length / 200, 0.2));
        if (keywordHits === 0 && message.length < 8) {
          return { allow: false, confidence, reason: 'canvas intent ambiguous' };
        }
        return { allow: true, confidence, reason: 'canvas intent accepted' };
      }

      if (task === 'scorecard.fact_check' || task === 'scorecard.verify' || task === 'scorecard.refute') {
        const hasClaimId = typeof taskParams.claimId === 'string' && taskParams.claimId.trim().length > 0;
        const hasClaimIds =
          Array.isArray(taskParams.claimIds) &&
          (taskParams.claimIds as unknown[]).some(
            (claimId) => typeof claimId === 'string' && claimId.trim().length > 0,
          );
        const summary = typeof taskParams.summary === 'string' ? taskParams.summary.trim() : '';
        const prompt = typeof taskParams.prompt === 'string' ? taskParams.prompt.trim() : '';
        if (!hasClaimId && !hasClaimIds && summary.length < 6 && prompt.length < 6) {
          return { allow: false, confidence: 0.2, reason: 'fact-check missing anchor' };
        }
        return {
          allow: true,
          confidence: hasClaimId || hasClaimIds ? 0.92 : 0.68,
          reason: 'fact-check accepted',
        };
      }

      return { allow: true, confidence: 0.8, reason: 'default allow' };
    };

    const buildFingerprint = (tool: string, normalizedParams: JsonObject): ToolCallFingerprint => {
      const task = typeof (normalizedParams as any)?.task === 'string' ? (normalizedParams as any).task : '';
      const taskParams =
        (normalizedParams as any)?.params && typeof (normalizedParams as any).params === 'object'
          ? ((normalizedParams as any).params as Record<string, unknown>)
          : {};
      const marker = [
        tool,
        task,
        typeof taskParams.room === 'string' ? taskParams.room.trim() : '',
        typeof taskParams.componentId === 'string' ? taskParams.componentId.trim() : '',
        typeof taskParams.message === 'string' ? taskParams.message.trim().toLowerCase() : '',
        typeof taskParams.query === 'string' ? taskParams.query.trim().toLowerCase() : '',
      ].join('|');
      return { key: marker, ts: Date.now() };
    };

    const consumeRoomEventBudget = (roomName: string): { ok: boolean; state: RoomBudgetState } => {
      const now = Date.now();
      const existing = roomEventBudget.get(roomName);
      if (!existing || now - existing.windowStart >= 1_000) {
        const nextState: RoomBudgetState = { windowStart: now, events: 1 };
        roomEventBudget.set(roomName, nextState);
        return { ok: true, state: nextState };
      }
      existing.events += 1;
      return { ok: existing.events <= EVENT_BUDGET_PER_SEC, state: existing };
    };

    const sendToolCall = async (tool: string, params: JsonObject, options: { reliable?: boolean } = {}) => {
      ensureToolCallListeners();
      let normalizedParams = normalizeOutgoingParams(tool, params);
      const forceReliableUpdate = shouldForceReliableUpdate(tool, normalizedParams);
      const reliable =
        options.reliable !== undefined
          ? options.reliable
          : !(tool === 'update_component' && enableLossyUpdates && !forceReliableUpdate);

      if (tool === 'dispatch_to_conductor') {
        const rawTask =
          typeof (normalizedParams as any)?.task === 'string'
            ? String((normalizedParams as any).task).trim()
            : '';
        const task = rawTask || 'auto';
        const taskParams =
          ((normalizedParams as any)?.params ?? {}) as Record<string, unknown>;
        const intentGate = evaluateDispatchIntent(task, taskParams);
        if (!intentGate.allow) {
          console.info('[VoiceAgent] dropped low-confidence dispatch', {
            task,
            reason: intentGate.reason,
            confidence: intentGate.confidence,
          });
          return;
        }

        if (task === 'canvas.agent_prompt' || task === 'auto') {
          const canvasParams = taskParams;
          const roomName = typeof canvasParams.room === 'string' && canvasParams.room.trim()
            ? canvasParams.room.trim()
            : job.room?.name || roomKey() || 'room';
          const message = typeof canvasParams.message === 'string' ? canvasParams.message.trim() : '';
          const requestId = typeof canvasParams.requestId === 'string' ? canvasParams.requestId.trim() : undefined;
          const nowTs = Date.now();
          if (
            message &&
            shouldSuppressCanvasDispatch({
              dispatches: recentCanvasDispatches,
              roomName,
              message,
              requestId,
              now: nowTs,
              suppressMs: CANVAS_DISPATCH_SUPPRESS_MS,
            })
          ) {
            console.info('[VoiceAgent] suppressing duplicate canvas.agent_prompt dispatch', {
              room: roomName,
              requestId,
            });
            return;
          }

          if (message) {
            const selectionIds = Array.isArray(canvasParams.selectionIds)
              ? canvasParams.selectionIds.filter((id) => typeof id === 'string')
              : undefined;
            const boundsCandidate = canvasParams.bounds as any;
            const bounds =
              boundsCandidate &&
              typeof boundsCandidate === 'object' &&
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
                : undefined;
            const metadataSafe =
              canvasParams.metadata && typeof canvasParams.metadata === 'object'
                ? (JSON.parse(JSON.stringify(canvasParams.metadata)) as any)
                : null;
            const intentId =
              requestId || randomUUID();
            normalizedParams = {
              task: 'fairy.intent',
              params: {
                id: intentId,
                room: roomName,
                message,
                source: 'voice',
                metadata: metadataSafe,
                ...(selectionIds ? { selectionIds } : {}),
                ...(bounds ? { bounds } : {}),
              },
            };
          }
        }
      }

      const roomName = job.room.name || roomKey() || 'room';
      const budget = consumeRoomEventBudget(roomName);
      if (!budget.ok) {
        console.warn('[VoiceAgent] tool_call budget exceeded, dropping event', {
          room: roomName,
          budget: EVENT_BUDGET_PER_SEC,
          events: budget.state.events,
          tool,
        });
        return;
      }

      const fingerprint = buildFingerprint(tool, normalizedParams);
      const lastSeen = recentToolCallFingerprints.get(fingerprint.key);
      if (typeof lastSeen === 'number' && fingerprint.ts - lastSeen < TOOL_DEDUPE_WINDOW_MS) {
        console.info('[VoiceAgent] duplicate tool_call dropped', {
          tool,
          ageMs: fingerprint.ts - lastSeen,
        });
        return;
      }
      recentToolCallFingerprints.set(fingerprint.key, fingerprint.ts);
      if (recentToolCallFingerprints.size > 500) {
        const cutoff = Date.now() - TOOL_DEDUPE_WINDOW_MS;
        for (const [key, ts] of recentToolCallFingerprints) {
          if (ts < cutoff) {
            recentToolCallFingerprints.delete(key);
          }
        }
      }

      const entry = { event: buildToolEvent(tool, normalizedParams, roomName), reliable };
      if (!job.room.localParticipant) {
        pendingToolCalls.push(entry);
        console.info('[VoiceAgent] queueing tool_call until room connects', {
          tool,
          queueLength: pendingToolCalls.length,
          state: job.room.connectionState,
        });
        if (!flushToolCallsHandle) {
          flushToolCallsHandle = setTimeout(() => {
            flushToolCallsHandle = null;
            void flushPendingToolCalls();
          }, 250);
        }
        return;
      }
      try {
        const sent = await publishToolCall(entry);
        if (!sent) {
          pendingToolCalls.push(entry);
          if (!flushToolCallsHandle) {
            flushToolCallsHandle = setTimeout(() => {
              flushToolCallsHandle = null;
              void flushPendingToolCalls();
            }, 250);
          }
        }
      } catch (error) {
        console.error('[VoiceAgent] publishData threw', { tool, error });
        pendingToolCalls.unshift(entry);
        if (!flushToolCallsHandle) {
          flushToolCallsHandle = setTimeout(() => {
            flushToolCallsHandle = null;
            void flushPendingToolCalls();
          }, 250);
        }
      }
    };

    const scorecardService = new ScorecardService({
      getRoomName: () => roomKey() || job.room?.name || 'room',
      componentRegistry,
      getActiveScorecard: () => activeScorecard,
      setActiveScorecard: (scorecard) => {
        activeScorecard = scorecard;
      },
      findLedgerEntryByMessage,
      registerLedgerEntry,
      setLastComponentForType,
      setLastCreatedComponentId,
      setLastScorecardProvisionedAt: (createdAt) => {
        lastScorecardProvisionedAt = createdAt;
      },
      listRemoteParticipantLabels,
      sendToolCall,
      sendScorecardSeedTask,
    });

    const toolParameters = createToolParametersSchema();
    const toolContext: llm.ToolContext = {
      create_component: llm.tool({
        description: 'Create a new component on the canvas.',
        parameters: z.object({
          type: z.string(),
          spec: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
          props: z.record(z.string(), z.any()).nullish(),
          messageId: z.string().nullish(),
          intentId: z.string().nullish(),
          slot: z.string().nullish(),
        }),
        execute: async (args) =>
          executeCreateComponent(args as any, {
            roomName: job.room.name || '',
            currentTurnId,
            scorecardSuppressWindowMs: SCORECARD_SUPPRESS_WINDOW_MS,
            lastScorecardProvisionedAt,
            setLastScorecardProvisionedAt: (createdAt) => {
              lastScorecardProvisionedAt = createdAt;
            },
            lastUserPrompt: lastUserPrompt ?? undefined,
            activeScorecard,
            findLatestScorecardEntryInRoom,
            getLastComponentForType,
            setLastComponentForType,
            setLastCreatedComponentId,
            getRecentCreateFingerprint,
            setRecentCreateFingerprint,
            getComponentEntry,
            setComponentEntry,
            findIntentByMessage: findLedgerEntryByMessage,
            findLedgerEntryByMessage,
            registerIntentEntry: registerLedgerEntry,
            registerLedgerEntry,
            listRemoteParticipantLabels,
            sendToolCall,
            sendScorecardSeedTask,
            setActiveScorecard: (next) => {
              activeScorecard = next;
            },
          }),
      }),
      create_infographic: llm.tool({
        description: 'Create (or reuse) an Infographic widget and trigger generation from current conversation context.',
        parameters: z
          .object({
            useGrounding: z.boolean().nullish(),
          })
          .passthrough(),
        execute: async (args) => {
          const payload: JsonObject = {};
          if (typeof (args as any)?.useGrounding === 'boolean') {
            payload.useGrounding = (args as any).useGrounding;
          }
          await sendToolCall('create_infographic', payload);
          return { status: 'queued' };
        },
      }),
      reserve_component: llm.tool({
        description: 'Reserve a component intent prior to creation to ensure deterministic IDs.',
        parameters: z.object({
          type: z.string().nullish(),
          spec: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
          props: z.record(z.string(), z.any()).nullish(),
          messageId: z.string().nullish(),
          intentId: z.string().nullish(),
          slot: z.string().nullish(),
        }),
        execute: async (args) => {
          const componentType = String(args.type || '').trim();
          if (!componentType) {
            return { status: 'ERROR', message: 'reserve_component requires type' };
          }

          if (args.spec === null) {
            delete (args as any).spec;
          }
          if (args.props === null) {
            delete (args as any).props;
          }
          if (args.messageId === null) {
            delete (args as any).messageId;
          }
          if (args.intentId === null) {
            delete (args as any).intentId;
          }

          const normalizedSpec = normalizeSpecInput(args.spec);
          const initialProps =
            args.props && typeof args.props === 'object'
              ? ({ ...args.props } as Record<string, unknown>)
              : {};
          const mergedProps = { ...normalizedSpec, ...initialProps };
          const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;

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

          const { intentId: autoIntentId, messageId: autoMessageId } = deriveComponentIntent({
            roomName: job.room.name || '',
            turnId: currentTurnId,
            componentType,
            spec: mergedProps,
            slot,
          });

          const intentId =
            typeof args.intentId === 'string' && args.intentId.trim().length > 0
              ? args.intentId.trim()
              : autoIntentId;
          const messageId =
            typeof args.messageId === 'string' && args.messageId.trim().length > 0
              ? args.messageId.trim()
              : autoMessageId;

          args.intentId = intentId;
          args.messageId = messageId;

          const existingComponent = getComponentEntry(messageId);
          if (existingComponent) {
            existingComponent.intentId = intentId;
            if (slot) {
              existingComponent.slot = slot;
            }
          }

          const entry = registerLedgerEntry({
            intentId,
            messageId,
            componentType,
            slot,
            state: existingComponent ? 'updated' : 'reserved',
          });

          setLastComponentForType(componentType, messageId);
          setLastCreatedComponentId(messageId);
          setRecentCreateFingerprint(componentType, {
            fingerprint: JSON.stringify(fingerprintPayload),
            messageId,
            createdAt: Date.now(),
            turnId: currentTurnId,
            intentId,
            slot,
          });

          const reserveParams: JsonObject = {
            componentType,
            messageId,
            snapshot: mergedProps as JsonObject,
            state: entry.state,
          };
          if (intentId) {
            reserveParams.intentId = intentId;
          }
          if (slot) {
            reserveParams.slot = slot;
          }
          await sendToolCall('reserve_component', reserveParams);

          return {
            status: existingComponent ? 'acknowledged_existing' : 'reserved',
            messageId,
            intentId,
            componentExists: Boolean(existingComponent),
          };
        },
      }),
      research_search: llm.tool({
        description: 'Run a general research query and render/update a ResearchPanel.',
        parameters: z.object({
          query: z.string().min(3),
          componentId: z.string().nullish(),
        }),
        execute: async (args) => {
          const query = typeof args.query === 'string' ? args.query.trim() : '';
          if (!query) {
            return { status: 'ERROR', message: 'research_search requires query text' };
          }
          const roomName = job.room.name || '';
          let componentId =
            typeof args.componentId === 'string' && args.componentId.trim().length > 0
              ? args.componentId.trim()
              : undefined;
          if (!componentId) {
            const provisioned = await ensureResearchPanelProvisioned(query);
            componentId = provisioned.componentId;
          } else {
            rememberResearchPanel(componentId);
          }
          await sendToolCall('dispatch_to_conductor', {
            task: 'search.general',
            params: {
              room: roomName,
              query,
              componentId,
            },
          });
          if (componentId) {
            rememberResearchPanel(componentId);
          }
          return { status: 'queued', query, componentId };
        },
      }),
      transcript_search: llm.tool({
        description: 'Return recent conversation segments from this room.',
        parameters: z
          .object({
            query: z.string().trim().nullish(),
            windowMs: z.number().int().min(3_000).max(300_000).nullish(),
          })
          .passthrough(),
        execute: async (args) => {
          const roomName = job.room.name;
          if (!roomName) {
            return { status: 'ERROR', message: 'No room context available' };
          }
          const windowMs = Math.min(Math.max(args.windowMs ?? 60_000, 3_000), 300_000);
          try {
            const { transcript } = await getTranscriptWindow(roomName, windowMs);
            const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
            const hits = transcript
              .filter((entry) => {
                if (!query) return true;
                return typeof entry.text === 'string' && entry.text.toLowerCase().includes(query);
              })
              .slice(0, 8)
              .map((entry) => ({
                speaker: entry.participantId ?? 'speaker',
                text: entry.text ?? '',
                timestamp: entry.timestamp ?? Date.now(),
              }));
            const summary = hits
              .map((hit) => `${new Date(hit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${hit.speaker}: ${hit.text}`)
              .join(' | ');
            return {
              status: 'queued',
              query: query || null,
              windowMs,
              count: hits.length,
              summary: summary || 'No matching transcript entries found.',
              hits,
            };
          } catch (error) {
            return { status: 'ERROR', message: 'Transcript lookup failed', detail: String(error) };
          }
        },
      }),
      resolve_component: llm.tool({
        description: 'Resolve an existing componentId using intent, slot, or type hints.',
        parameters: z.object({
          componentId: z.string().nullish(),
          intentId: z.string().nullish(),
          type: z.string().nullish(),
          slot: z.string().nullish(),
          allowLast: z.boolean().nullish(),
        }),
        execute: async (args) => {
          const resolvedId = resolveComponentId(args as Record<string, unknown>);
          if (!resolvedId) {
            return { status: 'NOT_FOUND', message: 'No component matched the provided hints' };
          }

          const existing = getComponentEntry(resolvedId);
          const intentId =
            typeof args.intentId === 'string' && args.intentId.trim().length > 0
              ? args.intentId.trim()
              : existing?.intentId ?? findLedgerEntryByMessage(resolvedId)?.intentId;
          const slot =
            typeof args.slot === 'string' && args.slot.trim().length > 0
              ? args.slot.trim()
              : existing?.slot ?? findLedgerEntryByMessage(resolvedId)?.slot;
          const componentType =
            typeof args.type === 'string' && args.type.trim().length > 0
              ? args.type.trim()
              : existing?.type ?? 'unknown';

          if (intentId) {
            registerLedgerEntry({
              intentId,
              messageId: resolvedId,
              componentType,
              slot,
              state: existing ? 'updated' : 'reserved',
            });
          }
          if (componentType && resolvedId) {
            setLastComponentForType(componentType, resolvedId);
          }
          if (componentType === 'ResearchPanel') {
            rememberResearchPanel(resolvedId);
          }
          setLastCreatedComponentId(resolvedId);

          return {
            status: 'RESOLVED',
            componentId: resolvedId,
            intentId: intentId ?? null,
          };
        },
      }),
      update_component: llm.tool({
        description: 'Update an existing component. REQUIRED: patch object with properties to update (e.g., { isRunning: false } for timer, { instruction: "..." } for complex widgets).',
        parameters: z.object({
          componentId: z.string().nullish(),
          type: z.string().nullish(),
          patch: z.union([z.string(), z.record(z.string(), z.any())]).describe('REQUIRED: Object with properties to update. For timers: { isRunning, configuredDuration, timeLeft, reset, addSeconds }. For complex widgets: { instruction: "user request" }'),
          intentId: z.string().nullish(),
          slot: z.string().nullish(),
        }),
        execute: async (args) => {
          let resolvedId =
            typeof args.componentId === 'string' && args.componentId.trim().length > 0
              ? args.componentId.trim()
              : '';

          if (!resolvedId && typeof args.type === 'string' && args.type.trim()) {
            const byType = getLastComponentForType(args.type.trim());
            if (byType) resolvedId = byType;
          }

          if (!resolvedId) {
            const lastCreated = getLastCreatedComponentId();
            if (lastCreated) {
              resolvedId = lastCreated;
            }
          }

          if (!resolvedId) {
            console.warn('[VoiceAgent] update_component missing componentId and no recent component found', args);
            return { status: 'ERROR', message: 'Missing componentId for update_component' };
          }

          const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
          const rawPatch = coerceComponentPatch(args.patch);
          const existing = getComponentEntry(resolvedId);
          const intentId =
            typeof args.intentId === 'string' && args.intentId.trim().length > 0
              ? args.intentId.trim()
              : existing?.intentId;
          if (intentId) {
            args.intentId = intentId;
          }
          const fallbackSeconds =
            typeof existing?.props?.configuredDuration === 'number' && Number.isFinite(existing.props.configuredDuration)
              ? (existing.props.configuredDuration as number)
              : 300;
          const patch = normalizeComponentPatch(rawPatch, fallbackSeconds);

          const isDebateScorecardTarget =
            existing?.type === 'DebateScorecard' ||
            (typeof args.type === 'string' && args.type.trim() === 'DebateScorecard') ||
            (activeScorecard && (!resolvedId || activeScorecard.componentId === resolvedId));

          if (isDebateScorecardTarget && !resolvedId && activeScorecard?.componentId) {
            resolvedId = activeScorecard.componentId;
          }

          if (!resolvedId) {
            console.warn('[VoiceAgent] update_component missing componentId after resolution', args);
            return { status: 'ERROR', message: 'Missing componentId for update_component' };
          }

          const payload: JsonObject = {
            componentId: resolvedId,
            patch,
          };
          if (intentId) {
            payload.intentId = intentId;
          }
          if (slot) {
            payload.slot = slot;
          }

          if (isDebateScorecardTarget) {
            const inferredTopic =
              typeof lastUserPrompt === 'string'
                ? inferScorecardTopicFromText(lastUserPrompt)
                : undefined;
            const patchTopic =
              typeof (patch as any)?.topic === 'string' && (patch as any).topic.trim().length > 0
                ? String((patch as any).topic).trim()
                : inferredTopic;
            const patchPlayersRaw = (patch as any)?.players;
            const patchPlayers =
              Array.isArray(patchPlayersRaw) && patchPlayersRaw.length > 0
                ? patchPlayersRaw
                    .map((player: any) => {
                      const side = player?.side === 'AFF' || player?.side === 'NEG' ? player.side : null;
                      const label = typeof player?.label === 'string' ? player.label.trim() : '';
                      if (!side || !label) return null;
                      const avatarUrl = typeof player?.avatarUrl === 'string' ? player.avatarUrl.trim() : undefined;
                      return { side, label, ...(avatarUrl ? { avatarUrl } : {}) };
                    })
                    .filter(Boolean)
                : undefined;
            const patchInstruction =
              typeof (patch as any)?.instruction === 'string' ? String((patch as any).instruction).trim() : '';
            const wantsMetaOnly =
              patchInstruction.length === 0 &&
              ((typeof patchTopic === 'string' && patchTopic.trim().length > 0) ||
                (Array.isArray(patchPlayers) && patchPlayers.length > 0));

            const conductorPayload: JsonObject = {
              componentId: resolvedId,
              room: job.room.name || '',
              windowMs: 60_000,
            };
            if (intentId) {
              conductorPayload.intent = intentId;
            }
            if (typeof patchTopic === 'string' && patchTopic.trim().length > 0) {
              conductorPayload.topic = patchTopic.trim();
            }
            if (Array.isArray(patchPlayers) && patchPlayers.length > 0) {
              conductorPayload.players = patchPlayers as any;
            }
            if (lastUserPrompt && lastUserPrompt.trim().length > 0 && !wantsMetaOnly) {
              conductorPayload.prompt = lastUserPrompt;
              conductorPayload.summary = lastUserPrompt.slice(0, 200);
            }
            await sendToolCall('dispatch_to_conductor', {
              task: wantsMetaOnly ? 'scorecard.seed' : 'scorecard.run',
              params: conductorPayload,
            });
            return { status: 'REDIRECTED', componentId: resolvedId };
          }

          await sendToolCall('update_component', payload);

          const existingAfter = getComponentEntry(resolvedId);
          if (existingAfter) {
            existingAfter.props = { ...existingAfter.props, ...patch };
            if (intentId) {
              existingAfter.intentId = intentId;
            }
            if (slot) {
              existingAfter.slot = slot;
            }
          }
          if (intentId) {
            const componentTypeHint =
              existingAfter?.type ||
              (typeof args.type === 'string' && args.type.trim().length > 0 ? args.type.trim() : 'unknown');
            registerLedgerEntry({
              intentId,
              messageId: resolvedId,
              componentType: componentTypeHint,
              slot,
              state: 'updated',
            });
          }
          setLastCreatedComponentId(resolvedId);

          return { status: 'queued', componentId: resolvedId };
        },
      }),
      remove_component: llm.tool({
        description: 'Remove an existing component from the canvas (delete its UI widget).',
        parameters: z.object({
          componentId: z.string().nullish(),
          type: z.string().nullish(),
          intentId: z.string().nullish(),
          slot: z.string().nullish(),
          allowLast: z.boolean().nullish(),
        }),
        execute: async (args) => {
          let resolvedId =
            typeof args.componentId === 'string' && args.componentId.trim().length > 0
              ? args.componentId.trim()
              : '';

          const typeHint = typeof args.type === 'string' && args.type.trim().length > 0 ? args.type.trim() : '';
          if (!resolvedId && typeHint) {
            const byType = getLastComponentForType(typeHint);
            if (byType) resolvedId = byType;
          }

          if (!resolvedId && args.allowLast) {
            const lastCreated = getLastCreatedComponentId();
            if (lastCreated) resolvedId = lastCreated;
          }

          if (!resolvedId) {
            console.warn('[VoiceAgent] remove_component missing componentId and no resolvable target', args);
            return { status: 'ERROR', message: 'Missing componentId for remove_component' };
          }

          const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
          const existing = getComponentEntry(resolvedId);
          const intentId =
            typeof args.intentId === 'string' && args.intentId.trim().length > 0
              ? args.intentId.trim()
              : existing?.intentId;

          const payload: JsonObject = { componentId: resolvedId };
          if (intentId) payload.intentId = intentId;
          if (slot) payload.slot = slot;
          if (typeHint) payload.type = typeHint;

          await sendToolCall('remove_component', payload);

          // Local bookkeeping so follow-up tool calls don't keep targeting a removed widget.
          pruneRemovedComponentState(resolvedId, existing?.type || typeHint);

          return { status: 'queued', componentId: resolvedId };
        },
      }),
      dispatch_to_conductor: llm.tool({
        description: 'Ask the conductor to run a steward for complex tasks like flowcharts or canvas drawing.',
        parameters: z.object({ task: z.string(), params: toolParameters }),
        execute: async (args) => {
          const roomName = job.room.name || '';
          const params = (args?.params as JsonObject) || {};
          const enrichedParams: JsonObject = { ...params };

          if (!enrichedParams.room && roomName) {
            enrichedParams.room = roomName;
          }

          if (
            (!enrichedParams.message || typeof enrichedParams.message !== 'string') &&
            typeof (params as Record<string, unknown>)?.instruction === 'string'
          ) {
            enrichedParams.message = String((params as Record<string, unknown>).instruction);
          }

          if (!enrichedParams.requestId) {
            enrichedParams.requestId = randomUUID();
          }

          if (
            args.task.startsWith('scorecard.') &&
            (!enrichedParams.topic ||
              typeof enrichedParams.topic !== 'string' ||
              (enrichedParams.topic as string).trim().length === 0)
          ) {
            const inferred =
              typeof lastUserPrompt === 'string'
                ? inferScorecardTopicFromText(lastUserPrompt)
                : null;
            if (inferred) {
              enrichedParams.topic = inferred;
            }
          }

          let componentTypeHint =
            typeof enrichedParams.type === 'string'
              ? enrichedParams.type
              : typeof enrichedParams.componentType === 'string'
                ? enrichedParams.componentType
                : typeof (params as Record<string, unknown>).type === 'string'
                  ? ((params as Record<string, unknown>).type as string)
                  : undefined;

          if (!componentTypeHint && args.task === 'scorecard.run') {
            componentTypeHint = 'DebateScorecard';
          }

          if (!enrichedParams.componentId) {
            const resolved = resolveComponentId({
              componentId: enrichedParams.componentId,
              intentId:
                typeof enrichedParams.intentId === 'string' ? enrichedParams.intentId : undefined,
              slot: typeof enrichedParams.slot === 'string' ? enrichedParams.slot : undefined,
              type: componentTypeHint,
            });
            if (resolved) {
              enrichedParams.componentId = resolved;
            }
          }

          if (
            !enrichedParams.componentId &&
            componentTypeHint === 'DebateScorecard' &&
            activeScorecard?.componentId
          ) {
            enrichedParams.componentId = activeScorecard.componentId;
          }

          if (!enrichedParams.componentId && args.task === 'scorecard.run') {
            const topicHint =
              typeof enrichedParams.topic === 'string' && enrichedParams.topic.trim().length > 0
                ? enrichedParams.topic.trim()
                : undefined;
            const promptContext =
              typeof enrichedParams.prompt === 'string' && enrichedParams.prompt.trim().length > 0
                ? enrichedParams.prompt.trim()
                : undefined;
            try {
              const ensured = await scorecardService.ensure(topicHint, promptContext);
              enrichedParams.componentId = ensured.componentId;
              enrichedParams.intentId = ensured.intentId;
              enrichedParams.topic = ensured.topic;
              if (!enrichedParams.room) {
                enrichedParams.room = roomName;
              }
            } catch (error) {
              console.warn('[VoiceAgent] scorecardService.ensure failed during dispatch', {
                topicHint,
                promptContext,
                error,
              });
            }
          }

          if (!enrichedParams.componentId && args.task === 'scorecard.run') {
            console.warn('[VoiceAgent] dispatch_to_conductor missing componentId for scorecard task', {
              params,
            });
          }

          await sendToolCall('dispatch_to_conductor', {
            ...args,
            params: enrichedParams,
          });
          return { status: 'queued' };
        },
      }),
    };

    // Build instructions and instantiate Agent + Session for Realtime
    const systemCapabilities = await queryCapabilities(job.room as any).catch(() => defaultCapabilities);
    instructions = buildVoiceAgentInstructions(systemCapabilities, systemCapabilities.components || []);

    const agent = new voice.Agent({
      instructions,
      tools: toolContext,
    });

    const session = new voice.AgentSession({
      llm: new openaiRealtime.RealtimeModel({}),
    });

    const coercePositiveInt = (value: unknown, fallback: number) => {
      const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
      return Math.floor(parsed);
    };
    const replyTimeoutMs = coercePositiveInt(process.env.VOICE_AGENT_REPLY_TIMEOUT_MS, 8_000);
    const interruptTimeoutMs = coercePositiveInt(process.env.VOICE_AGENT_INTERRUPT_TIMEOUT_MS, 1_500);
    const transcriptionReadyTimeoutMs = coercePositiveInt(process.env.VOICE_AGENT_TRANSCRIPTION_READY_TIMEOUT_MS, 10_000);
    const waitWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<{ ok: boolean; value?: T }> => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<{ ok: boolean }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ ok: false }), timeoutMs);
      });
      const result = await Promise.race([
        promise.then((value) => ({ ok: true as const, value })),
        timeoutPromise,
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return result.ok ? { ok: true, value: (result as { ok: true; value: T }).value } : { ok: false };
    };

    type PendingReply = { options: { userInput?: string }; attempts: number };
    const pendingReplies: PendingReply[] = [];
    let lastUserPrompt: string | null = null;
    let latestAgentState: voice.AgentState = 'initializing';
    let recoveringActiveResponse = false;

    const isActiveResponseError = (error: unknown) => {
      if (!error) return false;
      const rawMessage =
        typeof (error as { message?: unknown })?.message === 'string'
          ? (error as { message: string }).message
          : '';
      const message = rawMessage.toLowerCase();
      const code =
        (error as { code?: string })?.code ||
        (error as { error?: { code?: string } })?.error?.code ||
        (error as { detail?: { code?: string } })?.detail?.code;
      return (
        code === 'conversation_already_has_active_response' ||
        message.includes('active response') ||
        message.includes('already has an active response')
      );
    };

    const interruptRealtimeSession = async (reason: string, error?: unknown) => {
      if (recoveringActiveResponse) return;
      recoveringActiveResponse = true;
      console.warn('[VoiceAgent] recovering realtime session', {
        reason,
        error: error instanceof Error ? error.message : error,
      });
      try {
        const interruptFuture = session.interrupt();
        await waitWithTimeout(interruptFuture.await, interruptTimeoutMs);
      } catch { }
      recoveringActiveResponse = false;
      // Allow any queued replies to resume after recovery.
      if (!isGeneratingReply && pendingReplies.length > 0) {
        setTimeout(() => {
          if (!isGeneratingReply && pendingReplies.length > 0) {
            void generateReplySafely();
          }
        }, 250);
      }
    };

    const generateReplySafely = async (options?: { userInput?: string }) => {
      pendingReplies.push({ options: options ?? {}, attempts: 0 });
      if (isGeneratingReply) {
        console.log('[VoiceAgent] Queueing generateReply; active reply in progress', {
          queued: pendingReplies.length,
        });
        return;
      }

      isGeneratingReply = true;
      try {
        while (pendingReplies.length > 0) {
          const next = pendingReplies.shift();
          if (!next) continue;
          if (latestAgentState === 'thinking' || latestAgentState === 'speaking') {
            // Agent is still busy; requeue and wait briefly instead of hammering the realtime session.
            pendingReplies.unshift(next);
            await waitWithTimeout(new Promise((resolve) => setTimeout(resolve, 300)), 350);
            continue;
          }
          try {
            const speech = session.generateReply({ ...(next.options as any), toolChoice: 'required' }) as any;
            if (speech && typeof speech.waitForPlayout === 'function') {
              const completed = await waitWithTimeout(speech.waitForPlayout(), replyTimeoutMs);
              if (!completed.ok) {
                console.warn('[VoiceAgent] generateReply timed out; interrupting session', {
                  timeoutMs: replyTimeoutMs,
                  attempts: next.attempts,
                  userInput: next.options.userInput ? next.options.userInput.slice(0, 120) : undefined,
                });
                try {
                  speech.interrupt?.(true);
                } catch { }
                await interruptRealtimeSession('reply_timeout');

                if (next.attempts < 1) {
                  const retryOptions: { userInput?: string } = { ...next.options };
                  if (retryOptions.userInput) {
                    delete retryOptions.userInput;
                  }
                  pendingReplies.unshift({ options: retryOptions, attempts: next.attempts + 1 });
                }
              }
            }
          } catch (err) {
            if (isActiveResponseError(err)) {
              pendingReplies.unshift({ options: next.options, attempts: next.attempts + 1 });
              await interruptRealtimeSession('active_response_error', err);
              continue;
            }
            throw err;
          }
        }
      } catch (err) {
        logRealtimeError('generateReply queue failed', err);
        if (isActiveResponseError(err)) {
          await interruptRealtimeSession('active_response_error', err);
        }
      } finally {
        isGeneratingReply = false;
      }
    };

    handleBufferedTranscription = async ({
      text,
      speaker,
      participantId,
      participantName,
      isManual,
      timestamp,
    }) => {
      console.log('[VoiceAgent] DataReceived transcription', {
        text: allowSensitiveLogging ? text : `[redacted:${text.length}]`,
        isManual,
        speaker: allowSensitiveLogging ? speaker : '[redacted]',
        participantId: allowSensitiveLogging ? participantId : '[redacted]',
        participantName: allowSensitiveLogging ? participantName : '[redacted]',
        topic: 'transcription',
      });
      lastUserPrompt = text;

      // New user turn begins on a final transcript (manual or server STT).
      bumpTurn();

      const speakerLabel =
        participantName?.trim() ||
        speaker?.trim() ||
        participantId?.trim() ||
        'user';
      const attributedInput =
        speakerLabel && speakerLabel !== 'user' ? `${speakerLabel}: ${text}` : text;
      console.log(
        '[VoiceAgent] calling generateReply with userInput:',
        allowSensitiveLogging ? attributedInput.slice(0, 160) : '[redacted]',
      );
      try {
        appendTranscriptCache(job.room.name || 'unknown', {
          participantId: participantId || speakerLabel,
          participantName: participantName || (speakerLabel !== participantId ? speakerLabel : undefined),
          text,
          timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
        });
      } catch { }

      // Explicit "Canvas:" prefix routes directly to the Canvas steward (no extra LLM roundtrip).
      // This is an opt-in command style used by the demo harness and the transcript UI hint.
      if (isManual) {
        const trimmed = text.trim();
        const lower = trimmed.toLowerCase();
        const isCanvasPrefixed = lower.startsWith('canvas:') || lower.startsWith('/canvas');
        if (isCanvasPrefixed) {
          const message = trimmed.includes(':')
            ? trimmed.slice(trimmed.indexOf(':') + 1).trim()
            : lower.startsWith('/canvas')
              ? trimmed.slice('/canvas'.length).trim()
              : trimmed;
          const room = roomKey() || job.room?.name || 'room';
          await sendToolCall('dispatch_to_conductor', {
            task: 'canvas.agent_prompt',
            params: {
              room,
              message: message || trimmed,
            },
          });
          return;
        }

        // Demo-lap fast paths: for explicit, high-confidence commands we bypass the LLM to avoid
        // timeouts and reduce accidental duplicate tool calls. These are intentionally narrow.
        const looksLikeTimerCommand =
          (lower.startsWith('start') || lower.startsWith('create')) &&
          lower.includes('timer') &&
          (lower.includes('minute') || lower.includes('min'));
        if (looksLikeTimerCommand) {
          const tokens = lower.split(' ').filter(Boolean);
          let minutes: number | undefined;
          for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (token === 'minute' || token === 'minutes' || token === 'min' || token === 'mins') {
              const prev = tokens[i - 1] || '';
              const parsed = Number(prev);
              if (Number.isFinite(parsed) && parsed > 0) {
                minutes = Math.max(1, Math.round(parsed));
              }
              break;
            }
          }
          const initialMinutes = minutes ?? 5;
          await (toolContext as any).create_component.execute({
            type: 'RetroTimerEnhanced',
            spec: { initialMinutes, initialSeconds: 0, autoStart: true },
          });
          return;
        }

        const looksLikeTimerUpdate =
          lower.includes('timer') &&
          (lower.includes('pause') ||
            lower.includes('stop') ||
            lower.includes('resume') ||
            lower.includes('reset') ||
            lower.includes('set'));
        if (looksLikeTimerUpdate) {
          const timerId =
            getLastComponentForType('RetroTimerEnhanced') || getLastComponentForType('RetroTimer');
          if (timerId) {
            const tokens = lower.split(' ').filter(Boolean);
            let minutes: number | undefined;
            for (let i = 0; i < tokens.length; i += 1) {
              const token = tokens[i];
              if (token === 'minute' || token === 'minutes' || token === 'min' || token === 'mins') {
                const prev = tokens[i - 1] || '';
                const parsed = Number(prev);
                if (Number.isFinite(parsed) && parsed > 0) {
                  minutes = Math.max(1, Math.round(parsed));
                }
                break;
              }
            }
            const shouldPause = lower.includes('pause') || lower.includes('stop');
            const shouldResume = lower.includes('resume') || lower.includes('start');
            const shouldReset = lower.includes('reset') || lower.includes('set');
            const patch: Record<string, unknown> = {};
            if (typeof minutes === 'number' && Number.isFinite(minutes)) {
              const durationSeconds = Math.max(1, Math.round(minutes)) * 60;
              patch.configuredDuration = durationSeconds;
              patch.timeLeft = durationSeconds;
            }
            if (shouldPause) patch.isRunning = false;
            if (shouldResume && !shouldPause) patch.isRunning = true;
            if (shouldReset && !('isRunning' in patch)) {
              patch.isRunning = false;
            }
            await (toolContext as any).update_component.execute({
              componentId: timerId,
              patch,
            });
            return;
          }
        }

        const looksLikeLinearKanbanCommand =
          (lower.startsWith('create') || lower.startsWith('add') || lower.startsWith('open')) &&
          lower.includes('linear') &&
          lower.includes('kanban');
        if (looksLikeLinearKanbanCommand) {
          await (toolContext as any).create_component.execute({ type: 'LinearKanbanBoard' });
          return;
        }

        const looksLikeScorecardCommand =
          (lower.startsWith('start') || lower.startsWith('create') || lower.startsWith('open')) &&
          lower.includes('debate') &&
          (lower.includes('scorecard') || lower.includes('analysis'));
        if (looksLikeScorecardCommand) {
          const topic = inferScorecardTopicFromText(trimmed) ?? undefined;
          await (toolContext as any).create_component.execute({
            type: 'DebateScorecard',
            ...(topic ? { spec: { topic } } : {}),
          });
          return;
        }

        const looksLikeInfographicCommand = lower.includes('infographic') && (lower.startsWith('generate') || lower.startsWith('create'));
        if (looksLikeInfographicCommand) {
          await (toolContext as any).create_infographic.execute({});
          return;
        }

        const debateLinePrefixes = [
          'affirmative:',
          'negative:',
          'affirmative rebuttal:',
          'negative rebuttal:',
          'judge:',
        ];
        const looksLikeDebateLine = debateLinePrefixes.some((prefix) => lower.startsWith(prefix));
        if (looksLikeDebateLine && activeScorecard?.componentId) {
          await (toolContext as any).dispatch_to_conductor.execute({
            task: 'scorecard.run',
            params: {
              componentId: activeScorecard.componentId,
              prompt: trimmed,
              topic: activeScorecard.topic,
            },
          });
          return;
        }

        const looksLikeFactCheckCommand =
          lower.includes('fact-check') ||
          lower.includes('fact check') ||
          lower.startsWith('factcheck') ||
          lower.includes('add sources') ||
          lower.includes('verify the') ||
          lower.includes('verify this');
        if (looksLikeFactCheckCommand && activeScorecard?.componentId) {
          await (toolContext as any).dispatch_to_conductor.execute({
            task: 'scorecard.fact_check',
            params: {
              componentId: activeScorecard.componentId,
              summary: trimmed.slice(0, 240),
              topic: activeScorecard.topic,
            },
          });
          return;
        }
      }
      if (isManual && (process.env.VOICE_AGENT_ROUTER_ENABLED ?? 'true') !== 'false') {
        try {
          const routed = await routeManualInput(text);
          if (routed?.route === 'canvas') {
            const room = roomKey() || job.room?.name || 'room';
            await sendToolCall('dispatch_to_conductor', {
              task: 'fairy.intent',
              params: {
                id: randomUUID(),
                room,
                message: routed.message?.trim() || text,
                source: 'voice',
              },
            });
            return;
          }
        } catch (error) {
          console.warn('[VoiceAgent] manual router failed, falling back to realtime agent', error);
        }
      }

      await generateReplySafely({ userInput: attributedInput });
    };

    session.on((voice as any).AgentSessionEventTypes.FunctionToolsExecuted, async (event: any) => {
      const calls = event.functionCalls ?? [];
      console.log('[VoiceAgent] FunctionToolsExecuted', {
        count: calls.length,
        callNames: calls.map((c) => c.name),
      });
      console.log('[VoiceAgent] FunctionToolsExecuted raw', event);
      for (const fnCall of calls) {
        try {
          const args = JSON.parse(fnCall.args || '{}') as Record<string, unknown>;
          if (
            ![
              'create_component',
              'update_component',
              'remove_component',
              'dispatch_to_conductor',
              'reserve_component',
              'resolve_component',
            ].includes(fnCall.name)
          ) {
            continue;
          }
          if (fnCall.name === 'create_component') {
            if (args.spec === null) {
              delete args.spec;
            }
            if (args.props === null) {
              delete args.props;
            }
            const componentType = typeof args.type === 'string' ? args.type.trim() : '';
            const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
            const mergedSpec =
              args.spec && typeof args.spec === 'object'
                ? (args.spec as Record<string, unknown>)
                : {};
            const mergedProps =
              args.props && typeof args.props === 'object'
                ? { ...mergedSpec, ...(args.props as Record<string, unknown>) }
                : { ...mergedSpec };
            const fallbackIds = deriveComponentIntent({
              roomName: job.room.name || '',
              turnId: currentTurnId,
              componentType,
              spec: mergedProps,
              slot,
            });
            const intentId =
              typeof args.intentId === 'string' && args.intentId.trim().length > 0
                ? args.intentId.trim()
                : fallbackIds.intentId;
            const messageId =
              typeof args.messageId === 'string' && args.messageId.trim().length > 0
                ? args.messageId.trim()
                : fallbackIds.messageId;

            args.intentId = intentId;
            args.messageId = messageId;

            if (componentType && messageId) {
              setLastComponentForType(componentType, messageId);
              setLastCreatedComponentId(messageId);
              if (componentType === 'ResearchPanel') {
                rememberResearchPanel(messageId);
              }
              const existing = getComponentEntry(messageId);
              if (existing) {
                existing.intentId = intentId;
                if (slot) {
                  existing.slot = slot;
                }
                existing.room = job.room.name || 'room';
              } else {
                componentRegistry.set(messageId, {
                  type: componentType,
                  createdAt: Date.now(),
                  props: {} as JsonObject,
                  state: {} as JsonObject,
                  intentId,
                  slot,
                  room: job.room.name || 'room',
                });
              }
              if (intentId) {
                registerLedgerEntry({
                  intentId,
                  messageId,
                  componentType,
                  slot,
                  state: existing ? 'updated' : 'created',
                });
              }
            }
          }
          if (fnCall.name === 'update_component') {
            const resolvedId = resolveComponentId(args);
            if (!resolvedId) {
              console.warn('[VoiceAgent] Skipping update_component without componentId', args);
              continue;
            }
            args.componentId = resolvedId;
            const rawPatch = coerceComponentPatch(args.patch);
            const existingFT = getComponentEntry(resolvedId);
            const fallbackSeconds =
              typeof existingFT?.props?.configuredDuration === 'number' && Number.isFinite(existingFT.props.configuredDuration)
                ? (existingFT.props.configuredDuration as number)
                : 300;
            args.patch = normalizeComponentPatch(rawPatch, fallbackSeconds);
            const existingAfterFT = getComponentEntry(resolvedId);
            const componentTypeAfterUpdate =
              existingAfterFT?.type ||
              (typeof args.type === 'string' && args.type.trim().length > 0 ? args.type.trim() : '');
            if (componentTypeAfterUpdate === 'ResearchPanel') {
              rememberResearchPanel(resolvedId);
            }
            if (existingAfterFT) {
              existingAfterFT.props = { ...existingAfterFT.props, ...(args.patch as JsonObject) };
              if (typeof args.intentId === 'string' && args.intentId.trim().length > 0) {
                existingAfterFT.intentId = args.intentId.trim();
              }
              if (typeof args.slot === 'string' && args.slot.trim().length > 0) {
                existingAfterFT.slot = args.slot.trim();
              }
            }
            if (typeof args.intentId === 'string' && args.intentId.trim().length > 0) {
              registerLedgerEntry({
                intentId: args.intentId.trim(),
                messageId: resolvedId,
                componentType: componentTypeAfterUpdate || 'unknown',
                slot: typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : existingAfterFT?.slot,
                state: existingAfterFT ? 'updated' : 'reserved',
              });
            }
            setLastCreatedComponentId(resolvedId);
          }
          if (fnCall.name === 'remove_component') {
            const resolvedId = resolveComponentId(args);
            if (!resolvedId) {
              console.warn('[VoiceAgent] Skipping remove_component without componentId', args);
              continue;
            }
            args.componentId = resolvedId;

            const existingFT = getComponentEntry(resolvedId);
            const componentType =
              existingFT?.type ||
              (typeof args.type === 'string' && args.type.trim().length > 0 ? args.type.trim() : '');

            pruneRemovedComponentState(resolvedId, componentType);
          }
          if (fnCall.name === 'reserve_component') {
            const componentType = typeof args.type === 'string' ? args.type.trim() : '';
            const intentId = typeof args.intentId === 'string' ? args.intentId.trim() : '';
            const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
            const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
            if (componentType && messageId) {
              setLastComponentForType(componentType, messageId);
              setLastCreatedComponentId(messageId);
              if (componentType === 'ResearchPanel') {
                rememberResearchPanel(messageId);
              }
            }
            if (intentId && messageId && componentType) {
              registerLedgerEntry({
                intentId,
                messageId,
                componentType,
                slot,
                state: componentRegistry.has(messageId) ? 'updated' : 'reserved',
              });
            }
          }
          if (fnCall.name === 'resolve_component') {
            const resolvedId = typeof args.componentId === 'string' ? args.componentId.trim() : '';
            const componentType =
              typeof args.type === 'string'
                ? args.type.trim()
                : typeof args.componentType === 'string'
                  ? args.componentType.trim()
                  : '';
            if (resolvedId) {
              setLastCreatedComponentId(resolvedId);
              if (componentType === 'ResearchPanel') {
                rememberResearchPanel(resolvedId);
              }
            }
            const intentId = typeof args.intentId === 'string' ? args.intentId.trim() : '';
            const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
            if (intentId && resolvedId && componentType) {
              registerLedgerEntry({
                intentId,
                messageId: resolvedId,
                componentType,
                slot,
                state: componentRegistry.has(resolvedId) ? 'updated' : 'reserved',
              });
            }
          }
          console.debug('[VoiceAgent] FunctionToolsExecuted acknowledged', {
            name: fnCall.name,
            id: fnCall.id,
            resolvedComponentId: args.componentId,
          });
        } catch (error) {
          console.error('[VoiceAgent] Tool call handling failed', error);
        }
      }
    });

    if (!multiParticipantTranscriptionEnabled && transcriptionEnabled) {
      session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (event) => {
        const payload = {
          type: 'live_transcription',
          event_id: randomUUID(),
          text: event.transcript,
          speaker: 'user',
          participantId: 'user',
          timestamp: Date.now(),
          is_final: event.isFinal,
          manual: false,
          server_generated: true,
        };
        await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          reliable: event.isFinal,
          topic: 'transcription',
        });
        if (event.isFinal) {
          try {
            appendTranscriptCache(job.room.name || 'unknown', {
              participantId: 'user',
              participantName: 'user',
              text: event.transcript,
              timestamp: Date.now(),
              manual: false,
            });
          } catch { }

          // New user turn begins on a final transcript
          bumpTurn();

          const trimmed = event.transcript?.trim();
          if (trimmed) {
            lastUserPrompt = trimmed;
            try {
              await generateReplySafely();
            } catch (error) {
              logRealtimeError('generateReply after transcript failed', error);
            }
          }
        }
      });
    }

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
      if (allowSensitiveLogging) {
        console.log('[VoiceAgent] ConversationItem FULL', {
          type: event.item.type,
          role: event.item.role,
          hasFunctionCall: !!(event.item as any).functionCall,
          functionCall: (event.item as any).functionCall,
          functionCallId: (event.item as any).function_call_id,
          toolCalls: (event.item as any).tool_calls,
          content: (event.item as any).content,
          contentKinds: Array.isArray((event.item as any).content)
            ? (event.item as any).content.map((c: any) => c.type)
            : undefined,
        });
      }
      if (event.item.role !== 'assistant') return;
      const text = event.item.textContent ?? '';
      if (!text.trim()) return;

      const payload = {
        type: 'live_transcription',
        event_id: randomUUID(),
        text,
        speaker: 'voice-agent',
        participantId: 'voice-agent',
        timestamp: Date.now(),
        is_final: true,
        manual: false,
        server_generated: true,
      };
      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
        topic: 'transcription',
      });
      try {
        appendTranscriptCache(job.room.name || 'unknown', {
          participantId: 'voice-agent',
          participantName: 'voice-agent',
          text,
          timestamp: Date.now(),
          manual: false,
        });
      } catch { }
    });

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      logRealtimeError('session error', event.error);
    });

    session.on(voice.AgentSessionEventTypes.Close, (event) => {
      const payload: Record<string, unknown> = {
        reason: event.reason,
        code: (event as { code?: number }).code,
      };
      console.log('[VoiceAgent] session closed', payload);
      if (event.error) {
        logRealtimeError('session close error', event.error as unknown);
      }
      if (multiParticipantTranscriber) {
        void multiParticipantTranscriber.stop().catch(() => {});
      }
    });

    const enableTranscriptionProcessing = (reason: string) => {
      if (transcriptionProcessingEnabled) return;
      if (!handleBufferedTranscription) return;
      transcriptionProcessingEnabled = true;
      console.log('[VoiceAgent] transcription processing enabled', {
        reason,
        buffered: transcriptionBuffer.size(),
      });
      void drainPendingTranscriptions();
    };

    const transcriptionReadyTimer = setTimeout(() => {
      enableTranscriptionProcessing('timeout');
    }, transcriptionReadyTimeoutMs);
    transcriptionReadyTimer.unref?.();

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      latestAgentState = event.newState;
      if (event.newState !== 'initializing') {
        clearTimeout(transcriptionReadyTimer);
        enableTranscriptionProcessing(`agent_state_${event.newState}`);
      }
      if (event.newState === 'idle' && pendingReplies.length > 0 && !isGeneratingReply) {
        void generateReplySafely();
      }
    });

    const startPromise = session.start({
      agent,
      room: job.room,
      inputOptions: { audioEnabled: !multiParticipantTranscriptionEnabled },
      outputOptions: {
        audioEnabled: false,
        transcriptionEnabled: !multiParticipantTranscriptionEnabled && transcriptionEnabled,
      },
    });
    await startPromise;
  },
});

if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('voice-agent.ts')) {
  if (process.argv.length < 3) {
    process.argv.push('dev');
  }
  const coercePositiveInt = (value: unknown, fallback: number) => {
    const parsed =
      typeof value === 'string'
        ? Number(value)
        : typeof value === 'number'
          ? value
          : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  };

  const production = process.env.NODE_ENV === 'production';
  const initializeProcessTimeout = coercePositiveInt(
    process.env.VOICE_AGENT_PROCESS_INIT_TIMEOUT_MS,
    production ? 30_000 : 120_000,
  );
  const numIdleProcesses = production
    ? undefined
    : coercePositiveInt(process.env.VOICE_AGENT_IDLE_PROCESSES, 1);

  console.log('[VoiceAgent] worker options', {
    production,
    initializeProcessTimeout,
    numIdleProcesses,
  });

  const workerOptions = new WorkerOptions({
    agent: process.argv[1],
    agentName: 'voice-agent',
    production,
    initializeProcessTimeout,
    ...(typeof numIdleProcesses === 'number' ? { numIdleProcesses } : {}),
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    wsURL: process.env.LIVEKIT_URL,
  });
  cli.runApp(workerOptions);
}

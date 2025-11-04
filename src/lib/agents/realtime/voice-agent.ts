import { defineAgent, JobContext, cli, WorkerOptions, llm, voice } from '@livekit/agents';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { z } from 'zod';
// Removed temporary Responses API fallback for routing

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}
import { realtime as openaiRealtime } from '@livekit/agents-plugin-openai';
import { appendTranscriptCache } from '@/lib/agents/shared/supabase-context';
import { buildVoiceAgentInstructions } from '@/lib/agents/instructions';
import { queryCapabilities, defaultCapabilities } from '@/lib/agents/capabilities';
import { deriveComponentIntent } from '@/lib/agents/shared/deterministic-ids';
import { isStartDebate } from '@/lib/agents/debate-judge';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';
import { RoomEvent, RemoteTrackPublication, Track } from 'livekit-client';
import { createDefaultScorecardState } from '@/lib/agents/debate-scorecard-schema';

export default defineAgent({
  entry: async (job: JobContext) => {
    await job.connect();
    console.log('[VoiceAgent] Connected to room:', job.room.name);

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
    const envTranscriptionLanguage = process.env.VOICE_AGENT_TRANSCRIPTION_LANGUAGE?.trim();
    const fallbackTranscriptionLanguage = process.env.AGENT_STT_LANGUAGE?.trim();
    const resolvedInputTranscriptionModel = envInputTranscriptionModel || fallbackInputTranscriptionModel || undefined;
    const envTurnDetection = process.env.VOICE_AGENT_TURN_DETECTION?.trim().toLowerCase();
    const transcriptionEnabledFlag = coerceBooleanFromEnv(process.env.VOICE_AGENT_TRANSCRIPTION_ENABLED);
    const transcriptionEnabled = transcriptionEnabledFlag ?? Boolean(resolvedInputTranscriptionModel);
    const resolvedTranscriptionLanguage = envTranscriptionLanguage || fallbackTranscriptionLanguage || undefined;
    const inputAudioTranscription = transcriptionEnabled
      ? {
          model: resolvedInputTranscriptionModel || 'gpt-4o-mini-transcribe',
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

    type ComponentRegistryEntry = {
      type: string;
      createdAt: number;
      props: JsonObject;
      state: JsonObject;
      intentId?: string;
      slot?: string;
    };
    const componentRegistry = new Map<string, ComponentRegistryEntry>();
    const lastComponentByType = new Map<string, string>();
    let lastCreatedComponentId: string | null = null;
    type IntentLedgerEntry = {
      intentId: string;
      messageId: string;
      componentType: string;
      slot?: string;
      reservedAt: number;
      updatedAt: number;
      state: 'reserved' | 'created' | 'updated';
    };
    const intentLedger = new Map<string, IntentLedgerEntry>();
    const slotLedger = new Map<string, string>();
    const messageToIntent = new Map<string, string>();
    const LEDGER_TTL_MS = 5 * 60 * 1000;
    const recentDebatePrompts = new Map<string, number>();
    const DEBATE_PROMPT_DEBOUNCE_MS = 2000;
    const DEBATE_PROMPT_HISTORY_MS = 60_000;

    const cleanupLedger = () => {
      const now = Date.now();
      for (const [intentId, entry] of intentLedger.entries()) {
        if (now - entry.updatedAt > LEDGER_TTL_MS) {
          intentLedger.delete(intentId);
          if (entry.slot) {
            const currentIntent = slotLedger.get(entry.slot);
            if (currentIntent === intentId) {
              slotLedger.delete(entry.slot);
            }
          }
          const mappedIntent = messageToIntent.get(entry.messageId);
          if (mappedIntent === intentId) {
            messageToIntent.delete(entry.messageId);
          }
        }
      }
    };

    const registerLedgerEntry = (entry: {
      intentId: string;
      messageId: string;
      componentType: string;
      slot?: string;
      state?: IntentLedgerEntry['state'];
    }) => {
      const now = Date.now();
      const existing = intentLedger.get(entry.intentId);
      const next: IntentLedgerEntry = {
        intentId: entry.intentId,
        messageId: entry.messageId,
        componentType: entry.componentType,
        slot: entry.slot ?? existing?.slot,
        reservedAt: existing?.reservedAt ?? now,
        updatedAt: now,
        state: entry.state ?? existing?.state ?? 'reserved',
      };
      if (entry.slot) {
        next.slot = entry.slot;
      }
      intentLedger.set(next.intentId, next);
      messageToIntent.set(next.messageId, next.intentId);
      if (next.slot) {
        slotLedger.set(next.slot, next.intentId);
      }
      cleanupLedger();
      return next;
    };

    const findLedgerEntryByMessage = (messageId: string) => {
      const intentId = messageToIntent.get(messageId);
      if (intentId) {
        return intentLedger.get(intentId);
      }
      return undefined;
    };

    const shouldSkipDebatePrompt = (prompt: string) => {
      const normalized = prompt.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalized) return true;
      const now = Date.now();
      for (const [key, timestamp] of recentDebatePrompts.entries()) {
        if (now - timestamp > DEBATE_PROMPT_HISTORY_MS) {
          recentDebatePrompts.delete(key);
        }
      }
      const last = recentDebatePrompts.get(normalized);
      if (last && now - last < DEBATE_PROMPT_DEBOUNCE_MS) {
        return true;
      }
      recentDebatePrompts.set(normalized, now);
      return false;
    };

    // Duplicate suppression across turns: track last create by component type.
    // We suppress duplicates aggressively within the same user turn, and apply
    // a longer global TTL to catch late replays from the model/stack.
    let currentTurnId = 0;
    let activeResponse = false;
    const recentCreateFingerprints = new Map<
      string,
      {
        fingerprint: string;
        messageId: string;
        createdAt: number;
        turnId: number;
        intentId: string;
        slot?: string;
      }
    >();

    const bumpTurn = () => {
      currentTurnId += 1;
    };

    const enableLossyUpdates = process.env.VOICE_AGENT_UPDATE_LOSSY !== 'false';

    const sendToolCall = async (tool: string, params: JsonObject, options: { reliable?: boolean } = {}) => {
      const reliable =
        options.reliable !== undefined
          ? options.reliable
          : tool === 'update_component' && enableLossyUpdates
            ? false
            : true;
      const toolEvent = {
        id: randomUUID(),
        roomId: job.room.name || 'unknown',
        type: 'tool_call' as const,
        payload: { tool, params, context: { source: 'voice', timestamp: Date.now() } },
        timestamp: Date.now(),
        source: 'voice' as const,
      };
      const participantExists = !!job.room.localParticipant;
      console.log('[VoiceAgent] tool_call ready (from execute)', { participantExists, tool, params });
      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolEvent)), {
        reliable,
        topic: 'tool_call',
      });
    };

    const coerceComponentPatch = (raw: unknown) => {
      if (!raw) return {};
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { instruction: raw };
        } catch {
          return { instruction: raw };
        }
      }
      if (typeof raw === 'object') {
        return { ...(raw as Record<string, unknown>) };
      }
      return {};
    };

    const normalizeSpecInput = (raw: unknown): Record<string, unknown> => {
      if (!raw) return {};
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>) } : {};
        } catch {
          return {};
        }
      }
      if (raw && typeof raw === 'object') {
        return { ...(raw as Record<string, unknown>) };
      }
      return {};
    };

    const normalizeComponentPatch = (patch: Record<string, unknown>, fallbackSeconds: number) => {
      const next = { ...patch };
      const timestamp = Date.now();
      next.updatedAt = typeof next.updatedAt === 'number' ? next.updatedAt : timestamp;

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

      const coerceDurationValue = (value: unknown, fallbackSeconds: number) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Math.max(1, Math.round(value));
        }
        if (typeof value === 'string') {
          const cleaned = value.trim().toLowerCase();
          if (!cleaned) return fallbackSeconds;
          const parsed = Number.parseFloat(cleaned);
          if (!Number.isFinite(parsed)) return fallbackSeconds;
          const isMinutes =
            cleaned.includes('min') ||
            cleaned.endsWith('m') ||
            cleaned.endsWith('minutes') ||
            cleaned.endsWith('minute');
          const seconds = isMinutes ? parsed * 60 : parsed;
          return Math.max(1, Math.round(seconds));
        }
        return fallbackSeconds;
      };

      const coerceIntValue = (value: unknown, fallback: number) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Math.round(value);
        }
        if (typeof value === 'string') {
          const parsed = Number.parseFloat(value);
          if (Number.isFinite(parsed)) {
            return Math.round(parsed);
          }
        }
        return fallback;
      };

      if (next.duration !== undefined) {
        const durationSeconds = coerceDurationValue(
          next.duration,
          Math.max(1, Math.round((next as any).configuredDuration ?? fallbackSeconds)),
        );
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        next.configuredDuration = durationSeconds;
        if (typeof next.timeLeft !== 'number') {
          next.timeLeft = durationSeconds;
        }
        next.initialMinutes = minutes;
        next.initialSeconds = seconds;
        delete next.duration;
      }
      if (next.durationSeconds !== undefined) {
        const durationSeconds = coerceDurationValue(
          (next as any).durationSeconds,
          Math.max(1, Math.round((next as any).configuredDuration ?? fallbackSeconds)),
        );
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        next.configuredDuration = durationSeconds;
        if (typeof next.timeLeft !== 'number') {
          next.timeLeft = durationSeconds;
        }
        next.initialMinutes = minutes;
        next.initialSeconds = seconds;
      }
      if (next.initialMinutes !== undefined || next.initialSeconds !== undefined) {
        const clampMinutes = Math.max(
          1,
          coerceIntValue(
            (next as any).initialMinutes,
            Math.floor((((next as any).configuredDuration ?? fallbackSeconds) as number) / 60),
          ),
        );
        const clampSecondsRaw =
          (next as any).initialSeconds !== undefined
            ? coerceIntValue(
                (next as any).initialSeconds,
                (((next as any).configuredDuration ?? fallbackSeconds) as number) % 60,
              )
            : ((((next as any).configuredDuration ?? fallbackSeconds) as number) % 60);
        const clampSeconds = Math.max(0, Math.min(59, clampSecondsRaw));
        const totalSeconds = clampMinutes * 60 + clampSeconds;
        next.configuredDuration = totalSeconds;
        if (typeof next.timeLeft !== 'number') {
          next.timeLeft = totalSeconds;
        }
        next.initialMinutes = clampMinutes;
        next.initialSeconds = clampSeconds;
      }

      const runningValue =
        'running' in next ? coerceBoolean(next.running) : undefined;
      if (runningValue !== undefined) {
        next.isRunning = runningValue;
        if (runningValue) {
          next.isFinished = false;
          if (typeof next.timeLeft !== 'number' && typeof next.configuredDuration === 'number') {
            next.timeLeft = next.configuredDuration;
          }
        }
        delete next.running;
      }

      const autoStartValue =
        'autoStart' in next ? coerceBoolean(next.autoStart) : undefined;
      if (autoStartValue !== undefined) {
        next.autoStart = autoStartValue;
        next.isRunning = autoStartValue;
        if (autoStartValue) {
          next.isFinished = false;
          if (typeof next.timeLeft !== 'number' && typeof next.configuredDuration === 'number') {
            next.timeLeft = next.configuredDuration;
          }
        }
      }

      const statusValue =
        'status' in next ? coerceBoolean(next.status) : undefined;
      if (statusValue !== undefined && next.isRunning === undefined) {
        next.isRunning = statusValue;
        if (statusValue) {
          next.isFinished = false;
          if (typeof next.timeLeft !== 'number' && typeof next.configuredDuration === 'number') {
            next.timeLeft = next.configuredDuration;
          }
        }
      }

      return next;
    };

    const toolParameters = jsonObjectSchema.default({});
    const toolContext: llm.ToolContext = {
      create_component: llm.tool({
        description: 'Create a new component on the canvas.',
        parameters: z.object({
          type: z.string(),
          spec: z.union([z.string(), z.record(z.any())]).nullish(),
          props: z.record(z.any()).nullish(),
          messageId: z.string().nullish(),
          intentId: z.string().nullish(),
          slot: z.string().nullish(),
        }),
        execute: async (args) => {
          const componentType = String(args.type || '').trim();
          if (!componentType) {
            return { status: 'ERROR', message: 'create_component requires type' };
          }

          const normalizedType = componentType.toLowerCase();
          if (normalizedType === 'airesponse') {
            const roomName = job.room.name || '';
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

            const requestId = typeof args.messageId === 'string' && args.messageId.trim().length > 0
              ? args.messageId.trim()
              : randomUUID();

            const quickTextParams: JsonObject = {
              room: roomName,
              text,
              requestId,
            };
            if (args.props && typeof args.props === 'object') {
              const propsRecord = args.props as Record<string, unknown>;
              if (typeof propsRecord.x === 'number' && Number.isFinite(propsRecord.x)) {
                quickTextParams.x = propsRecord.x as number;
              }
              if (typeof propsRecord.y === 'number' && Number.isFinite(propsRecord.y)) {
                quickTextParams.y = propsRecord.y as number;
              }
            }

            await sendToolCall('dispatch_to_conductor', {
              task: 'canvas.quick_text',
              params: quickTextParams,
            });

            return { status: 'queued', messageId: requestId };
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

          const normalizedSpec = normalizeSpecInput(args.spec);

          const initialProps =
            args.props && typeof args.props === 'object'
              ? ({ ...args.props } as Record<string, unknown>)
              : {};

          const mergedProps = {
            ...normalizedSpec,
            ...initialProps,
          };

          const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
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
          args.spec = mergedProps;
          args.messageId = messageId;

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
          const recentCreate = recentCreateFingerprints.get(componentType);
          const now = Date.now();
          const TTL_MS = 30000; // 30s window to absorb late replays
          const sameTurnDuplicate =
            !!recentCreate &&
            recentCreate.fingerprint === sortedFingerprint &&
            recentCreate.turnId === currentTurnId;
          const withinGlobalTtl =
            !!recentCreate && recentCreate.fingerprint === sortedFingerprint && now - recentCreate.createdAt < TTL_MS;
          const intentMatches = !!recentCreate && recentCreate.intentId === intentId;
          const slotMatches =
            !slot || !recentCreate ? true : recentCreate.slot === slot;
          if (intentMatches && slotMatches && (sameTurnDuplicate || withinGlobalTtl)) {
            console.log('[VoiceAgent] suppressing duplicate create_component', {
              componentType,
              recentMessageId: recentCreate.messageId,
            });
            lastComponentByType.set(componentType, recentCreate.messageId);
            lastCreatedComponentId = recentCreate.messageId;
            args.intentId = recentCreate.intentId;
            args.messageId = recentCreate.messageId;
            return { status: 'duplicate_skipped', messageId: recentCreate.messageId };
          }

          const existingComponent = componentRegistry.get(messageId);
          if (existingComponent) {
            const fallbackSeconds =
              typeof existingComponent?.props?.configuredDuration === 'number' &&
              Number.isFinite(existingComponent.props.configuredDuration)
                ? (existingComponent.props.configuredDuration as number)
                : 300;
            const normalizedPatch = normalizeComponentPatch(mergedProps as Record<string, unknown>, fallbackSeconds);
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
            await sendToolCall(
              'update_component',
              {
                componentId: messageId,
                patch: normalizedPatch as JsonObject,
                intentId,
                slot,
              },
              { reliable: false },
            );
            existingComponent.props = {
              ...existingComponent.props,
              ...mergedProps,
            };
            existingComponent.intentId = intentId;
            if (slot) {
              existingComponent.slot = slot;
            }
            if (intentId) {
              registerLedgerEntry({
                intentId,
                messageId,
                componentType,
                slot,
                state: 'updated',
              });
            }
            lastComponentByType.set(componentType, messageId);
            lastCreatedComponentId = messageId;
            recentCreateFingerprints.set(componentType, {
              fingerprint: sortedFingerprint,
              messageId,
              createdAt: now,
              turnId: currentTurnId,
              intentId,
              slot,
            });
            return { status: 'queued', messageId, reusedExisting: true };
          }

          componentRegistry.set(messageId, {
            type: componentType,
            createdAt: Date.now(),
            props: mergedProps as JsonObject,
            state: {} as JsonObject,
            intentId,
            slot,
          });
          if (intentId) {
            registerLedgerEntry({
              intentId,
              messageId,
              componentType,
              slot,
              state: 'created',
            });
          }
          lastComponentByType.set(componentType, messageId);
          lastCreatedComponentId = messageId;
          recentCreateFingerprints.set(componentType, {
            fingerprint: sortedFingerprint,
            messageId,
            createdAt: now,
            turnId: currentTurnId,
            intentId,
            slot,
          });

          const payload: JsonObject = {
            type: componentType,
            messageId,
          };
          payload.spec = mergedProps as JsonObject;
          if (initialProps && Object.keys(initialProps).length > 0) {
            payload.props = initialProps as JsonObject;
          }

          if (intentId) {
            payload.intentId = intentId;
          }
          if (slot) {
            payload.slot = slot;
          }

          await sendToolCall('create_component', payload);
          return { status: 'queued', messageId };
        },
      }),
      reserve_component: llm.tool({
        description: 'Reserve a component intent prior to creation to ensure deterministic IDs.',
        parameters: z.object({
          type: z.string().nullish(),
          spec: z.union([z.string(), z.record(z.any())]).nullish(),
          props: z.record(z.any()).nullish(),
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

          const existingComponent = componentRegistry.get(messageId);
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

          lastComponentByType.set(componentType, messageId);
          lastCreatedComponentId = messageId;
          recentCreateFingerprints.set(componentType, {
            fingerprint: JSON.stringify(fingerprintPayload),
            messageId,
            createdAt: Date.now(),
            turnId: currentTurnId,
            intentId,
            slot,
          });

          await sendToolCall('reserve_component', {
            componentType,
            intentId,
            messageId,
            slot,
            snapshot: mergedProps as JsonObject,
            state: entry.state,
          });

          return {
            status: existingComponent ? 'acknowledged_existing' : 'reserved',
            messageId,
            intentId,
            componentExists: Boolean(existingComponent),
          };
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

          const existing = componentRegistry.get(resolvedId);
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
            lastComponentByType.set(componentType, resolvedId);
          }
          lastCreatedComponentId = resolvedId;

          return {
            status: 'RESOLVED',
            componentId: resolvedId,
            intentId: intentId ?? null,
          };
        },
      }),
      update_component: llm.tool({
        description: 'Update an existing component with a patch.',
        parameters: z.object({
          componentId: z.string().nullish(),
          type: z.string().nullish(),
          patch: z.union([z.string(), z.record(z.any())]).nullish(),
          intentId: z.string().nullish(),
          slot: z.string().nullish(),
        }),
        execute: async (args) => {
          let resolvedId =
            typeof args.componentId === 'string' && args.componentId.trim().length > 0
              ? args.componentId.trim()
              : '';

          if (!resolvedId && typeof args.type === 'string' && args.type.trim()) {
            const byType = lastComponentByType.get(args.type.trim());
            if (byType) resolvedId = byType;
          }

          if (!resolvedId && lastCreatedComponentId) {
            resolvedId = lastCreatedComponentId;
          }

          if (!resolvedId) {
            console.warn('[VoiceAgent] update_component missing componentId and no recent component found', args);
            return { status: 'ERROR', message: 'Missing componentId for update_component' };
          }

          const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
          const rawPatch = coerceComponentPatch(args.patch);
          const existing = componentRegistry.get(resolvedId);
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
            const conductorPayload: JsonObject = {
              componentId: resolvedId,
              room: job.room.name || '',
              windowMs: 60_000,
            };
            if (intentId) {
              conductorPayload.intent = intentId;
            }
            if (lastUserPrompt && lastUserPrompt.trim().length > 0) {
              conductorPayload.prompt = lastUserPrompt;
              conductorPayload.summary = lastUserPrompt.slice(0, 200);
            }
            await sendToolCall('dispatch_to_conductor', {
              task: 'scorecard.run',
              params: conductorPayload,
            });
            return { status: 'REDIRECTED', componentId: resolvedId };
          }

          await sendToolCall('update_component', payload, { reliable: false });

          const existingAfter = componentRegistry.get(resolvedId);
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
          lastCreatedComponentId = resolvedId;

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

          const componentTypeHint =
            typeof enrichedParams.type === 'string'
              ? enrichedParams.type
              : typeof enrichedParams.componentType === 'string'
                ? enrichedParams.componentType
                : typeof args?.params?.type === 'string'
                  ? (args.params as Record<string, unknown>).type
                  : undefined;

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
      name: 'voice-agent',
      instructions,
      tools: toolContext,
    });

    const session = new voice.AgentSession({
      llm: new openaiRealtime.RealtimeModel({}),
    });

    let pendingReply: { userInput?: string } | null = null;
    let lastUserPrompt: string | null = null;
    const generateReplySafely = async (options?: { userInput?: string }) => {
      if (activeResponse) {
        // Defer this request until the current response settles
        pendingReply = options ?? {};
        console.log('[VoiceAgent] Queueing generateReply; active response in progress');
        return;
      }
      activeResponse = true;
      try {
        await session.generateReply(options as any);
      } finally {
        activeResponse = false;
        if (pendingReply) {
          const next = pendingReply;
          pendingReply = null;
          activeResponse = true;
          try {
            await session.generateReply(next as any);
          } catch (err) {
            console.error('[VoiceAgent] queued generateReply failed', err);
          } finally {
            activeResponse = false;
          }
        }
      }
    };

    let activeScorecard: { componentId: string; intentId: string; topic: string } | null = null;
    let ensureScorecardPromise: Promise<{ componentId: string; intentId: string; topic: string }> | null = null;
    const debateKeywordRegex =
      /\b(aff|affirmative|neg|negative|contention|rebuttal|voter|judge|debate|scorecard|flow|argument|claim|evidence|verify|fact|counter)\b/;

    const findExistingScorecard = (topic?: string) => {
      const normalized = topic?.trim().toLowerCase();
      let fallback: { id: string; info: ComponentRegistryEntry; topic?: string } | null = null;
      for (const [id, info] of componentRegistry.entries()) {
        if (info.type !== 'DebateScorecard') continue;
        const infoTopic =
          typeof info.props?.topic === 'string' && info.props.topic.trim().length > 0
            ? info.props.topic.trim()
            : typeof info.state?.topic === 'string' && info.state.topic.trim().length > 0
              ? info.state.topic.trim()
              : undefined;
        if (!fallback || info.createdAt > fallback.info.createdAt) {
          fallback = { id, info, topic: infoTopic };
        }
        if (normalized && infoTopic?.toLowerCase() === normalized) {
          return { id, info, topic: infoTopic };
        }
      }
      return fallback;
    };

    const ensureDebateScorecard = async (topic?: string, contextText?: string) => {
      const normalizedTopic = topic && topic.trim().length ? topic.trim() : undefined;
      const normalizedLower = normalizedTopic?.toLowerCase();

      if (ensureScorecardPromise) {
        const pending = await ensureScorecardPromise;
        if (!normalizedLower || pending.topic.toLowerCase() === normalizedLower) {
          return pending;
        }
      }

      if (
        activeScorecard &&
        (!normalizedLower || activeScorecard.topic.toLowerCase() === normalizedLower)
      ) {
        return activeScorecard;
      }

      const existing = findExistingScorecard(normalizedTopic);
      if (existing) {
        const ledgerEntry = findLedgerEntryByMessage(existing.id);
        const inferredTopic = normalizedTopic ?? existing.topic ?? activeScorecard?.topic ?? 'Live Debate';
        const intentId =
          existing.info.intentId?.trim() ||
          ledgerEntry?.intentId ||
          `debate-scorecard-${existing.id}`;
        existing.info.intentId = intentId;
        registerLedgerEntry({
          intentId,
          messageId: existing.id,
          componentType: 'DebateScorecard',
          slot: existing.info.slot,
          state: 'updated',
        });
        lastComponentByType.set('DebateScorecard', existing.id);
        lastCreatedComponentId = existing.id;
        activeScorecard = { componentId: existing.id, intentId, topic: inferredTopic };
        return activeScorecard;
      }

      const createScorecard = async () => {
        const topicLabel = normalizedTopic ?? activeScorecard?.topic ?? 'Live Debate';
        const intentId = `debate-scorecard-${Date.now()}`;
        const messageId = intentId;
        const initialState = createDefaultScorecardState(topicLabel);
        if (contextText && contextText.trim().length > 0) {
          const affMatch = contextText.match(/affirmative(?: team| side| camp)?\s*(?:is|=|:)\s*([^.;]+)/i);
          const negMatch = contextText.match(/negative(?: team| side| camp)?\s*(?:is|=|:)\s*([^.;]+)/i);
          if (affMatch?.[1]) {
            initialState.players[0].label = affMatch[1].trim();
          }
          if (negMatch?.[1]) {
            initialState.players[1].label = negMatch[1].trim();
          }
          initialState.status.lastAction = `Initialized debate${topicLabel ? ` on ${topicLabel}` : ''} with ${initialState.players[0].label} vs ${initialState.players[1].label}.`;
        }
        initialState.componentId = messageId;
        initialState.version = 0;
        initialState.lastUpdated = Date.now();

        await sendToolCall('reserve_component', {
          type: 'DebateScorecard',
          intentId,
          messageId,
          spec: initialState as JsonObject,
        });

        await sendToolCall('create_component', {
          type: 'DebateScorecard',
          componentId: messageId,
          messageId,
          spec: initialState as JsonObject,
        });

        activeScorecard = { componentId: messageId, intentId, topic: topicLabel };
        lastComponentByType.set('DebateScorecard', messageId);
        lastCreatedComponentId = messageId;
        registerLedgerEntry({
          intentId,
          messageId,
          componentType: 'DebateScorecard',
          state: 'created',
        });
        return activeScorecard;
      };

      ensureScorecardPromise = createScorecard();
      try {
        return await ensureScorecardPromise;
      } finally {
        ensureScorecardPromise = null;
      }
    };

    const maybeHandleDebate = async (text: string) => {
      const trimmed = (text || '').trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (shouldSkipDebatePrompt(trimmed)) {
        return;
      }
      const roomName = job.room.name || 'room';
      try {
        lastUserPrompt = trimmed;
        if (isStartDebate(trimmed)) {
          const topicMatch = trimmed.match(/debate(?: analysis| scorecard)?(?: for| about| on)?\s*(.*)$/i);
          const topic = topicMatch && topicMatch[1] ? topicMatch[1].trim() : 'Live Debate';
          const scorecard = await ensureDebateScorecard(topic || 'Live Debate', trimmed);
          await sendToolCall('dispatch_to_conductor', {
            task: 'scorecard.run',
            params: {
              room: roomName,
              componentId: scorecard.componentId,
              summary: `initialize debate scorecard for ${scorecard.topic}`,
              intent: 'scorecard.init',
              prompt: trimmed,
            } as JsonObject,
          });
          return;
        }
        if (debateKeywordRegex.test(lower)) {
          const scorecard = activeScorecard ?? (await ensureDebateScorecard(undefined, trimmed));
          await sendToolCall('dispatch_to_conductor', {
            task: 'scorecard.run',
            params: {
              room: roomName,
              componentId: scorecard.componentId,
              summary: trimmed.slice(0, 180),
              intent: 'scorecard.update',
              prompt: trimmed,
            } as JsonObject,
          });
        }
      } catch (err) {
        console.warn('[VoiceAgent] Debate judge handling failed', err);
      }
    };

    const resolveComponentId = (args: Record<string, unknown>) => {
      const rawId = typeof args.componentId === 'string' ? args.componentId.trim() : '';
      if (rawId) return rawId;

      const rawIntent = typeof args.intentId === 'string' ? args.intentId.trim() : '';
      if (rawIntent) {
        const entry = intentLedger.get(rawIntent);
        if (entry) {
          return entry.messageId;
        }
        for (const [id, info] of componentRegistry.entries()) {
          if (info.intentId === rawIntent) {
            return id;
          }
        }
      }

      const rawSlot = typeof args.slot === 'string' ? args.slot.trim() : '';
      if (rawSlot) {
        const slotIntent = slotLedger.get(rawSlot);
        if (slotIntent) {
          const entry = intentLedger.get(slotIntent);
          if (entry) {
            return entry.messageId;
          }
        }
        for (const [id, info] of componentRegistry.entries()) {
          if (info.slot === rawSlot) {
            return id;
          }
        }
      }

      const rawType =
        typeof args.type === 'string'
          ? args.type.trim()
          : typeof args.componentType === 'string'
            ? args.componentType.trim()
            : '';
      if (rawType) {
        const byType = lastComponentByType.get(rawType);
        if (byType) return byType;
      }
      if (rawType) {
        for (const [id, info] of componentRegistry.entries()) {
          if (info.type === rawType) {
            return id;
          }
        }
      }
      if (lastCreatedComponentId) {
        return lastCreatedComponentId;
      }
      return '';
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
              lastComponentByType.set(componentType, messageId);
              lastCreatedComponentId = messageId;
              const existing = componentRegistry.get(messageId);
              if (existing) {
                existing.intentId = intentId;
                if (slot) {
                  existing.slot = slot;
                }
              } else {
                componentRegistry.set(messageId, {
                  type: componentType,
                  createdAt: Date.now(),
                  props: {} as JsonObject,
                  state: {} as JsonObject,
                  intentId,
                  slot,
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
            const existingFT = componentRegistry.get(resolvedId);
            const fallbackSeconds =
              typeof existingFT?.props?.configuredDuration === 'number' && Number.isFinite(existingFT.props.configuredDuration)
                ? (existingFT.props.configuredDuration as number)
                : 300;
            args.patch = normalizeComponentPatch(rawPatch, fallbackSeconds);
            const existingAfterFT = componentRegistry.get(resolvedId);
            if (existingAfterFT) {
              existingAfterFT.props = { ...existingAfterFT.props, ...(args.patch as Record<string, unknown>) };
              if (typeof args.intentId === 'string' && args.intentId.trim().length > 0) {
                existingAfterFT.intentId = args.intentId.trim();
              }
              if (typeof args.slot === 'string' && args.slot.trim().length > 0) {
                existingAfterFT.slot = args.slot.trim();
              }
            }
            if (typeof args.intentId === 'string' && args.intentId.trim().length > 0) {
              const componentType =
                existingAfterFT?.type ||
                (typeof args.type === 'string' && args.type.trim().length > 0 ? args.type.trim() : 'unknown');
              registerLedgerEntry({
                intentId: args.intentId.trim(),
                messageId: resolvedId,
                componentType,
                slot: typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : existingAfterFT?.slot,
                state: existingAfterFT ? 'updated' : 'reserved',
              });
            }
            lastCreatedComponentId = resolvedId;
          }
          if (fnCall.name === 'reserve_component') {
            const componentType = typeof args.type === 'string' ? args.type.trim() : '';
            const intentId = typeof args.intentId === 'string' ? args.intentId.trim() : '';
            const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
            const slot = typeof args.slot === 'string' && args.slot.trim().length > 0 ? args.slot.trim() : undefined;
            if (componentType && messageId) {
              lastComponentByType.set(componentType, messageId);
              lastCreatedComponentId = messageId;
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
            if (resolvedId) {
              lastCreatedComponentId = resolvedId;
            }
            const intentId = typeof args.intentId === 'string' ? args.intentId.trim() : '';
            const componentType =
              typeof args.type === 'string'
                ? args.type.trim()
                : typeof args.componentType === 'string'
                  ? args.componentType.trim()
                  : '';
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

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (event) => {
      const payload = { type: 'live_transcription', text: event.transcript, speaker: 'user', timestamp: Date.now(), is_final: event.isFinal };
      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: event.isFinal,
        topic: 'transcription',
      });
      if (event.isFinal) {
        try {
          appendTranscriptCache(job.room.name || 'unknown', {
            participantId: 'user',
            text: event.transcript,
            timestamp: Date.now(),
          });
          void maybeHandleDebate(event.transcript);
        } catch {}

        // New user turn begins on a final transcript
        bumpTurn();

        const trimmed = event.transcript?.trim();
        if (trimmed) {
          try {
            await generateReplySafely();
          } catch (error) {
            console.error('[VoiceAgent] failed to generate reply after transcript', error);
          }
        }
      }
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
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
      if (event.item.role !== 'assistant') return;
      const text = event.item.textContent ?? '';
      if (!text.trim()) return;

      const payload = { type: 'live_transcription', text, speaker: 'voice-agent', timestamp: Date.now(), is_final: true };
      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
        topic: 'transcription',
      });
      try {
        appendTranscriptCache(job.room.name || 'unknown', {
          participantId: 'voice-agent',
          text,
          timestamp: Date.now(),
        });
      } catch {}
    });

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      console.error('[VoiceAgent] session error', event.error);
    });

    session.on(voice.AgentSessionEventTypes.Close, (event) => {
      console.log('[VoiceAgent] session closed', event.reason);
    });

    job.room.on(RoomEvent.DataReceived, async (payload, participant, _, topic) => {
      if (topic !== 'transcription') return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        const text = typeof message?.text === 'string' ? message.text.trim() : '';
        const isManual = Boolean(message?.manual);
        const isReplay = Boolean(message?.replay);
        const speaker = typeof message?.speaker === 'string' ? message.speaker : participant?.identity;
        console.log('[VoiceAgent] DataReceived transcription', { text, isManual, isReplay, speaker, topic });
        if (!text || isReplay) return;
        if (!isManual && speaker === 'voice-agent') return;
        lastUserPrompt = text;
        // Native Realtime tool-calling path
        console.log('[VoiceAgent] calling generateReply with userInput:', text);
        try {
          if (isManual) {
            // Treat manual messages as their own turn to avoid cross-talk
            bumpTurn();
          }
          await generateReplySafely({ userInput: text });
        } catch (err) {
          console.error('[VoiceAgent] generateReply error:', err);
        }
      } catch (error) {
        console.error('[VoiceAgent] failed to handle data transcription', error);
      }
    });

    await session.start({
      agent,
      room: job.room,
      inputOptions: { audioEnabled: true },
      outputOptions: { audioEnabled: false, transcriptionEnabled },
    });
  },
});

if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('voice-agent.ts')) {
  if (process.argv.length < 3) {
    process.argv.push('dev');
  }
  const workerOptions = new WorkerOptions({
    agent: process.argv[1],
    agentName: 'voice-agent',
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    wsURL: process.env.LIVEKIT_URL,
  });
  cli.runApp(workerOptions);
}

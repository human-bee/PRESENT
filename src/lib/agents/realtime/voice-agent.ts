import { defineAgent, JobContext, cli, WorkerOptions, llm, voice } from '@livekit/agents';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { z } from 'zod';

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}
import { realtime as openaiRealtime } from '@livekit/agents-plugin-openai';
import { appendTranscriptCache } from '@/lib/agents/shared/supabase-context';
import { DebateJudgeManager, isStartDebate } from '@/lib/agents/debate-judge';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';

/** Voice agent using OpenAI Realtime API for speech-to-tool-calls */
export default defineAgent({
  entry: async (job: JobContext) => {
    await job.connect();
    console.log('[VoiceAgent] Connected to room:', job.room.name);

    const transcriptionMode = (process.env.VOICE_AGENT_TRANSCRIPTION_MODE || 'realtime').toLowerCase();
    const manualTranscription = transcriptionMode === 'manual';

    if (manualTranscription) {
      console.log('[VoiceAgent] running in manual transcription mode');
    } else {
      console.log('[VoiceAgent] running in realtime transcription mode');
    }

    // Listen for manual text messages sent from the UI (typed messages, not speech)
    // eslint-disable-next-line prefer-const
    let session: voice.AgentSession;
    job.room.on('dataReceived' as any, async (payload: Uint8Array, participant: any, _: any, topic?: string) => {
      if (topic !== 'transcription') return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        const text = typeof message?.text === 'string' ? message.text.trim() : '';
        const isManual = Boolean(message?.manual);
        const isReplay = Boolean(message?.replay);
        const speaker = typeof message?.speaker === 'string' ? message.speaker : participant?.identity;
        
        console.log('[VoiceAgent] Received transcription data', { text, isManual, isReplay, speaker });
        
        // Skip replay messages and agent's own messages
        if (!text || isReplay) return;
        if (!isManual && speaker === 'voice-agent') return;
        
        // For manual (typed) messages, trigger the agent to generate a reply
        if (isManual && session) {
          console.log('[VoiceAgent] Processing manual text message:', text);
          try {
            await enqueueGenerateReply({ userInput: text });
          } catch (error) {
            console.error('[VoiceAgent] Failed to process manual message', error);
          }
        }
      } catch (error) {
        console.warn('[VoiceAgent] Failed to handle data transcription', error);
      }
    });

    const instructions = `You are a UI automation agent. You respond to user requests by calling tools to manipulate the canvas or create components.

AVAILABLE COMPONENTS (use with create_component):
- RetroTimerEnhanced: Timer with AI updates (5-120 minutes)
- YoutubeEmbed: Embed YouTube videos by ID
- LinearKanbanBoard: Project management kanban board with Linear integration
- LivekitParticipantTile: Video/audio participant tile (requires LivekitRoomConnector first)
- LivekitRoomConnector: Establishes LiveKit room connection
- ComponentToolbox: Draggable toolbox showing all components
- DocumentEditor: Collaborative document editor with AI updates
- ResearchPanel: Display research findings with credibility ratings
- ActionItemTracker: Task management with priorities and assignees
- WeatherForecast: Display weather data visually
- DebateScorecard: Live debate tracking with scoring
- OnboardingGuide: Interactive help and onboarding
- AIImageGenerator: Real-time AI image generation
- LiveCaptions: Live caption display

AVAILABLE STEWARDS (use with dispatch_to_conductor):
- canvas.agent_prompt: For drawing, arranging, organizing shapes on canvas
- flowchart.*: For creating/updating flowcharts (handled by flowchart steward)
- youtube.*: For YouTube search and video operations

RULES:
1. For canvas work (draw, sticky note, shapes, organize, etc.): call dispatch_to_conductor with task "canvas.agent_prompt"
2. For flowcharts: call dispatch_to_conductor with task "flowchart.*"
3. For component creation: call create_component (optionally pass messageId if you want to name it). The tool returns componentId.
4. For component updates: call update_component with componentId. If you omit componentId, include type and the most recently created component of that type will be updated.
5. To see existing components (and their IDs): call list_components.
6. ONLY call tools when the user makes a clear request. Do NOT call tools repeatedly or speculatively.

Examples:
Timer:
- "add a timer" → create_component({ type: "RetroTimerEnhanced", spec: "{}" })
- "set it to 8 minutes" → update_component({ componentId: "<id>", patch: { initialMinutes: 8 } })
- "make it 10 minutes" → update_component({ componentId: "<id>", patch: { initialMinutes: 10 } })
- "make the latest timer 12 minutes" → update_component({ type: "RetroTimerEnhanced", patch: { initialMinutes: 12 } })

YouTube:
- "show video dQw4w9WgXcQ" → create_component({ type: "YoutubeEmbed", spec: "{\\"videoId\\": \\"dQw4w9WgXcQ\\"}" })

Kanban Board:
- "add a kanban board" → create_component({ type: "LinearKanbanBoard", spec: "{}" })

Participant Tiles (LiveKit):
- "show participant video" → create_component({ type: "LivekitParticipantTile", spec: "{\\"participantIdentity\\": \\"<name>\\"}" })
- Note: Must create LivekitRoomConnector first!

Toolbox:
- "show the toolbox" → create_component({ type: "ComponentToolbox", spec: "{}" })

Canvas Drawing:
- "draw a cat" → dispatch_to_conductor({ task: "canvas.agent_prompt", params: { room: CURRENT_ROOM, message: "draw a cat", requestId: "<uuid>" } })
- "arrange in a grid" → dispatch_to_conductor({ task: "canvas.agent_prompt", params: { room: CURRENT_ROOM, message: "arrange in a grid", requestId: "<uuid>" } })

Flowcharts:
- "create a flowchart" → dispatch_to_conductor({ task: "flowchart.create", params: { room: CURRENT_ROOM, requestId: "<uuid>" } })

Management:
- "what components exist?" → list_components()
- "hi" → (no tool call needed)

Timer Component Patch Format:
- Use "initialMinutes" (number) for timer duration in minutes
- Use "initialSeconds" (number) for additional seconds
- Use "autoStart" (boolean) to auto-start the timer
- Example: {"initialMinutes": 7} or {"initialMinutes": 5, "initialSeconds": 30}

Component Update Workflow:
1. When you create a component, SAVE the componentId from the response (create_component returns it).
2. update_component accepts componentId. If you omit componentId, include the component type and the most recently created component of that type will be updated.
3. If unsure which component to update, call list_components first to see IDs and types.

Important: Call each tool ONCE per user request. Do not make multiple tool calls unless explicitly asked.`;

    // Track created components so we can reference them for updates
    const componentRegistry = new Map<string, { type: string; createdAt: number; props: JsonObject; state: JsonObject }>();
    const lastComponentByType = new Map<string, string>();

    type PendingReplyRequest = {
      options?: { userInput?: string };
      resolve: () => void;
      reject: (error: unknown) => void;
      createdAt: number;
    };

    // Gate OpenAI Realtime responses so we never call generateReply while one is in flight.
    // When the agent is interrupted mid-playback, we wait for the agent state to return to listening/idle
    // before delivering the next queued transcript.
    const replyQueue: PendingReplyRequest[] = [];
    let replyInFlight = false;
    let activeReply: PendingReplyRequest | null = null;
    let replyTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearReplyTimeout = () => {
      if (replyTimeout) {
        clearTimeout(replyTimeout);
        replyTimeout = null;
      }
    };

    const forceReleaseReplyQueue = (reason: string, requeueActive = false) => {
      if (!replyInFlight) return;
      const pending = requeueActive && activeReply ? activeReply : null;
      console.warn('[VoiceAgent] Releasing reply queue due to', reason);
      replyInFlight = false;
      activeReply = null;
      clearReplyTimeout();
      setTimeout(() => {
        if (!replyInFlight) {
          if (pending) {
            replyQueue.unshift(pending);
          }
          processReplyQueue();
        }
      }, 0);
    };

    const scheduleReplyTimeout = () => {
      clearReplyTimeout();
      replyTimeout = setTimeout(() => {
        forceReleaseReplyQueue('timeout');
      }, 8000);
    };

    const processReplyQueue = () => {
      if (replyInFlight) return;
      const next = replyQueue.shift();
      if (!next) return;

      replyInFlight = true;
      activeReply = next;

      try {
        session.generateReply(next.options);
        next.resolve();
        scheduleReplyTimeout();
      } catch (error) {
        replyInFlight = false;
        activeReply = null;
        clearReplyTimeout();
        console.error('[VoiceAgent] Failed to start reply', error);
        next.reject(error);
        setTimeout(processReplyQueue, 0);
      }
    };

    const enqueueGenerateReply = (options?: { userInput?: string }) =>
      new Promise<void>((resolve, reject) => {
        replyQueue.push({
          options,
          resolve,
          reject,
          createdAt: Date.now(),
        });
        processReplyQueue();
      });

    const sendToolCall = async (tool: string, params: JsonObject & { messageId?: string }) => {
      const messageId = typeof params.messageId === 'string' && params.messageId ? params.messageId : randomUUID();
      const toolEvent = {
        id: messageId,
        roomId: job.room.name || 'unknown',
        type: 'tool_call' as const,
        payload: { tool, params, context: { source: 'voice', timestamp: Date.now() } },
        timestamp: Date.now(),
        source: 'voice' as const,
      };
      const participantExists = !!job.room.localParticipant;
      console.log('[VoiceAgent] tool_call ready (from execute)', { participantExists, tool, params, messageId });
      
      // Track component creation
      if (tool === 'create_component' && typeof params.type === 'string') {
        const initialProps = ((params.props as JsonObject | undefined) ?? {}) as JsonObject;
        const specProps = (() => {
          const specVal = params.spec as JsonObject | string | undefined;
          if (specVal && typeof specVal === 'object') return specVal as JsonObject;
          if (typeof specVal === 'string') {
            try {
              return JSON.parse(specVal) as JsonObject;
            } catch {
              return {} as JsonObject;
            }
          }
          return {} as JsonObject;
        })();
        componentRegistry.set(messageId, {
          type: params.type,
          createdAt: Date.now(),
          props: { ...specProps, ...initialProps },
          state: {} as JsonObject,
        });
        lastComponentByType.set(params.type, messageId);
        console.log('[VoiceAgent] Registered component:', { componentId: messageId, type: params.type });
      }
      
      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolEvent)), {
        reliable: true,
        topic: 'tool_call',
      });
      if (!participantExists) {
        console.warn('[VoiceAgent] localParticipant missing, tool_call not sent');
      }
      
      return messageId;
    };

    const toolParameters = jsonObjectSchema.default({});
    const toolContext: llm.ToolContext = {
      create_component: llm.tool({
        description: 'Create a new component on the canvas. Returns the componentId (messageId) which you can use to update it later.',
        parameters: z.object({
          type: z.string(),
          spec: z.union([z.string(), z.record(z.any())]).optional().nullable(),
          messageId: z.string().optional(),
          props: z.record(z.any()).optional().nullable(),
        }),
        execute: async (args) => {
          const { type, spec, props, messageId } = args;
          const payload: JsonObject = { type };
          if (typeof spec === 'string') {
            payload.spec = spec;
          } else if (spec && typeof spec === 'object') {
            payload.spec = spec as JsonObject;
          }
          if (props && typeof props === 'object') {
            payload.props = props as JsonObject;
          }
          if (messageId) {
            payload.messageId = messageId;
          }

          const componentId = await sendToolCall('create_component', payload);
          const registryEntry = componentRegistry.get(componentId);
          if (registryEntry) {
            registryEntry.props = {
              ...(((spec && typeof spec === 'object') ? (spec as JsonObject) : {}) as JsonObject),
              ...(typeof spec === 'string'
                ? (() => {
                    try {
                      return JSON.parse(spec);
                    } catch {
                      return {};
                    }
                  })()
                : {}),
              ...(props && typeof props === 'object' ? (props as JsonObject) : {}),
            };
            componentRegistry.set(componentId, registryEntry);
          }
          lastComponentByType.set(type, componentId);
          return { status: 'queued', componentId };
        },
      }),
      update_component: llm.tool({
        description: 'Update an existing component with a patch. Use componentId from create_component or list_components.',
        parameters: z.object({
          componentId: z.string().optional(),
          type: z.string().optional(),
          patch: z.any(),
        }),
        execute: async (args) => {
          const { componentId, type, patch } = args as {
            componentId?: string;
            type?: string;
            patch: unknown;
          };

          const resolvedId = componentId || (type ? lastComponentByType.get(type) : undefined);
          if (!resolvedId) {
            console.warn('[VoiceAgent] update_component missing componentId and no known component for type', { type });
            return { status: 'error', message: 'Missing componentId for update_component' };
          }

          const payload: JsonObject = { componentId: resolvedId };
          let parsedPatch: JsonObject | undefined;
          if (typeof patch === 'string') {
            try {
              const parsed = JSON.parse(patch);
              parsedPatch = (parsed && typeof parsed === 'object') ? (parsed as JsonObject) : { instruction: patch };
            } catch {
              parsedPatch = { instruction: patch } as JsonObject;
            }
          } else if (patch && typeof patch === 'object') {
            parsedPatch = patch as JsonObject;
          }
          if (parsedPatch) {
            payload.patch = parsedPatch;
            const entry = componentRegistry.get(resolvedId);
            if (entry) {
              entry.props = { ...entry.props, ...parsedPatch };
              componentRegistry.set(resolvedId, entry);
            }
          }

          await sendToolCall('update_component', payload);
          return { status: 'queued' };
        },
      }),
      list_components: llm.tool({
        description: 'List all components created in this session with their IDs and types.',
        parameters: z.object({}),
        execute: async () => {
          const components = Array.from(componentRegistry.entries()).map(([id, info]) => ({
            componentId: id,
            type: info.type,
            props: info.props,
            state: info.state,
            createdAt: new Date(info.createdAt).toISOString(),
          }));
          console.log('[VoiceAgent] Listing components:', components);
          return { components };
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

          await sendToolCall('dispatch_to_conductor', {
            ...args,
            params: enrichedParams,
          });
          return { status: 'queued' };
        },
      }),
    };

    const realtimeModel = new openaiRealtime.RealtimeModel({
      model: 'gpt-realtime',
      toolChoice: 'auto', // Changed from 'required' to 'auto' - let the model decide when to call tools
      // Explicitly enable transcription - this is REQUIRED for the Realtime API to transcribe
      inputAudioTranscription: manualTranscription ? null : { model: 'whisper-1' },
      // Enable server-side turn detection so the API knows when to process speech
      turnDetection: manualTranscription ? null : { type: 'server_vad' },
    });

    const agent = new voice.Agent({
      instructions,
      tools: toolContext,
    });

    // Assign to the outer session variable so manual message handler can use it
    session = new voice.AgentSession({
      llm: realtimeModel,
      // Use server-side turn detection to automatically detect when user is speaking
      turnDetection: 'manual' as any, // SDK will use the model's turnDetection config
    });

    // Debug: Log all events from the session to see what's actually firing
    const originalOn = session.on.bind(session);
    const allEvents = new Set<string>();
    (session as any).on = function(event: any, handler: any) {
      if (!allEvents.has(event)) {
        allEvents.add(event);
        console.log('[VoiceAgent] Registering listener for event:', event);
      }
      return originalOn(event as any, handler);
    };

    const debateJudgeManager = new DebateJudgeManager(job.room as any, job.room.name || 'room');
    const debateKeywordRegex = /\b(aff|affirmative|neg|negative|contention|rebuttal|voter|judge|debate|scorecard|flow|argument|claim|evidence)\b/;

    const maybeHandleDebate = async (text: string) => {
      const trimmed = (text || '').trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      try {
        if (isStartDebate(trimmed)) {
          const topicMatch = trimmed.match(/debate(?: analysis| scorecard)?(?: for| about| on)?\s*(.*)$/i);
          const topic = topicMatch && topicMatch[1] ? topicMatch[1].trim() : 'Live Debate';
          await debateJudgeManager.ensureScorecard(topic || 'Live Debate');
          await debateJudgeManager.runPrompt(trimmed);
          return;
        }
        if (debateJudgeManager.isActive() && debateKeywordRegex.test(lower)) {
          await debateJudgeManager.runPrompt(trimmed);
        }
      } catch (err) {
        console.warn('[VoiceAgent] Debate judge handling failed', err);
      }
    };

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      console.debug('[VoiceAgent] Agent state changed', {
        oldState: event.oldState,
        newState: event.newState,
      });
      if (replyInFlight && (event.newState === 'listening' || event.newState === 'idle')) {
        replyInFlight = false;
        activeReply = null;
        clearReplyTimeout();
        processReplyQueue();
      }
    });

    session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, async (event) => {
      const calls = event.functionCalls ?? [];
      console.log('[VoiceAgent] FunctionToolsExecuted', {
        count: calls.length,
        callNames: calls.map((c) => c.name),
      });
      console.log('[VoiceAgent] FunctionToolsExecuted raw', event);
      for (const fnCall of calls) {
        try {
          const args = JSON.parse(fnCall.args || '{}');
          if (!['create_component', 'update_component', 'dispatch_to_conductor'].includes(fnCall.name)) {
            continue;
          }
          const toolEvent = {
            id: fnCall.id,
            roomId: job.room.name || 'unknown',
            type: 'tool_call',
            payload: { tool: fnCall.name, params: args, context: { source: 'voice', timestamp: Date.now() } },
            timestamp: Date.now(),
            source: 'voice' as const,
          };
          const participantExists = !!job.room.localParticipant;
          console.log('[VoiceAgent] tool_call ready', { participantExists, toolEvent });
          await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolEvent)), {
            reliable: true,
            topic: 'tool_call',
          });
          if (!participantExists) {
            console.warn('[VoiceAgent] localParticipant missing, tool_call not sent');
          }
        } catch (error) {
          console.error('[VoiceAgent] Tool call handling failed', error);
        }
      }
    });

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (event) => {
      console.log('[VoiceAgent] UserInputTranscribed:', {
        transcript: event.transcript,
        isFinal: event.isFinal,
        length: event.transcript?.length || 0,
      });
      
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

        const trimmed = event.transcript?.trim();
        if (trimmed) {
          console.log('[VoiceAgent] Generating reply for transcript:', trimmed);
          try {
            await enqueueGenerateReply();
          } catch (error) {
            console.error('[VoiceAgent] failed to generate reply after transcript', error);
          }
        } else {
          console.log('[VoiceAgent] Skipping reply generation - empty transcript');
        }
      }
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
      console.log('[VoiceAgent] ConversationItem', {
        type: event.item.type,
        role: event.item.role,
        hasFunctionCall: !!(event.item as any).functionCall,
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
      const code = (event.error as { code?: string } | undefined)?.code;
      if (code === 'conversation_already_has_active_response') {
        forceReleaseReplyQueue('active_response_error', true);
      }
    });

    session.on(voice.AgentSessionEventTypes.Close, (event) => {
      console.log('[VoiceAgent] session closed', event.reason);
    });

    // Log participant connections (using correct SDK event names)
    job.room.on('participantConnected', (participant: any) => {
      console.log('[VoiceAgent] Participant connected:', participant.identity || participant.sid);
    });

    job.room.on('trackSubscribed', (track: any, publication: any, participant: any) => {
      console.log('[VoiceAgent] Track subscribed:', {
        kind: track.kind,
        participantIdentity: participant.identity || participant.sid,
        trackSid: publication.sid,
      });
    });

    await session.start({
      agent,
      room: job.room,
      inputOptions: { audioEnabled: true },
      outputOptions: { audioEnabled: false, transcriptionEnabled: !manualTranscription },
    });

    console.log('[VoiceAgent] Session started successfully', {
      manualTranscription,
      transcriptionEnabled: !manualTranscription,
      audioEnabled: true,
      roomName: job.room.name,
      participantCount: job.room.remoteParticipants?.size || 0,
    });

    // Debug: Listen to ALL possible events to see what fires
    const possibleEvents = [
      'input_speech_transcription_completed',
      'input_speech_transcription_failed',
      'input_speech_started',
      'input_speech_stopped',
      'input_audio_buffer_committed',
      'conversation_item_created',
      'response_created',
      'response_done',
      'error',
    ];
    possibleEvents.forEach(eventName => {
      (session as any).on(eventName, (evt: any) => {
        console.log(`[VoiceAgent] Event fired: ${eventName}`, evt);
      });
    });

  },
});

// CLI runner for local dev
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

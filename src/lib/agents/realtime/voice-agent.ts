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
import { DebateJudgeManager, isStartDebate } from '@/lib/agents/debate-judge';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';
import { RoomEvent, RemoteTrackPublication, Track } from 'livekit-client';

/** I replace the entire entry implementation with manual AgentSession handling and reroute listeners to the session. */
export default defineAgent({
  entry: async (job: JobContext) => {
    await job.connect();

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

    const instructions = `You are a UI automation agent. You NEVER speak—you only act by calling tools.

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

    const sendToolCall = async (tool: string, params: JsonObject) => {
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
        reliable: true,
        topic: 'tool_call',
      });
      if (!participantExists) {
        console.warn('[VoiceAgent] localParticipant missing, tool_call not sent');
      }
    };

    const toolParameters = jsonObjectSchema.default({});
    const toolContext: llm.ToolContext = {
      create_component: llm.tool({
        description: 'Create a new component on the canvas.',
        parameters: z.object({ type: z.string(), spec: z.string() }),
        execute: async (args) => {
          await sendToolCall('create_component', args);
          return { status: 'queued' };
        },
      }),
      update_component: llm.tool({
        description: 'Update an existing component with a patch.',
        parameters: z.object({ componentId: z.string(), patch: z.string() }),
        execute: async (args) => {
          await sendToolCall('update_component', args);
          return { status: 'queued' };
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
      toolChoice: 'required',
      inputAudioTranscription: null,
      turnDetection: null,
    });

    const agent = new voice.Agent({
      instructions,
      tools: toolContext,
    });

    const session = new voice.AgentSession({
      llm: realtimeModel,
      turnDetection: 'manual',
    });

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

    session.on((voice as any).AgentSessionEventTypes.FunctionCall, async (event: any) => {
      const fnCall = event.call;
      console.log('[VoiceAgent] FunctionCall event received', { fnCall, eventKeys: Object.keys(event) });
      if (!fnCall) {
        console.warn('[VoiceAgent] FunctionCall event has NO call object!', event);
        return;
      }
      console.log('[VoiceAgent] FunctionCall VALID', { name: fnCall.name, args: fnCall.args });
      try {
        const args = JSON.parse(fnCall.args || '{}');
        if (!['create_component', 'update_component', 'dispatch_to_conductor'].includes(fnCall.name)) {
          return;
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
    });

    session.on((voice as any).AgentSessionEventTypes.FunctionToolsExecuted, async (event: any) => {
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
          try {
            await session.generateReply();
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
        // Native Realtime tool-calling path
        console.log('[VoiceAgent] calling generateReply with userInput:', text);
        try {
          await session.generateReply({ userInput: text });
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
      outputOptions: { audioEnabled: false, transcriptionEnabled: false },
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

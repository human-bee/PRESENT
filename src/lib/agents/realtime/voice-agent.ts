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
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { RoomEvent } from 'livekit-client';

const enqueueQueue = new AgentTaskQueue();

export default defineAgent({
  entry: async (job: JobContext) => {
    await job.connect();
    console.log('[VoiceAgent] Connected to room:', job.room.name);

    const enqueueTask = async (payload: JsonObject) => {
      const room = job.room.name || 'unknown';
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : randomUUID();
      const resourceKeys = Array.isArray(payload?.resourceKeys) ? payload.resourceKeys : [`room:${room}`];
      const taskName = typeof payload?.task === 'string' ? payload.task : 'conductor.dispatch';
      const params = (payload?.params as JsonObject) ?? payload;

      await enqueueQueue.enqueueTask({
        room,
        task: taskName,
        params: { ...params, room },
        requestId,
        resourceKeys,
      });

      const event = {
        id: requestId,
        roomId: room,
        type: 'tool_call' as const,
        payload: { tool: 'enqueue_task', params: payload, context: { source: 'voice', timestamp: Date.now() } },
        timestamp: Date.now(),
        source: 'voice' as const,
      };

      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(event)), {
        reliable: true,
        topic: 'tool_call',
      });
    };

    const instructions = `You are a lightweight voice interface for a multi-participant canvas room.

When you detect an actionable intent (explicit or implicit), immediately enqueue a task for the Conductor and return. Do not wait for the Conductor or stewards to finish.

How to respond:
1. Capture the user's request or inferred task.
2. Call enqueue_task({ intent: "short description", transcript: FULL_TEXT, participants: LIST, metadata? })
3. Always include the exact transcript snippet you used.
4. Do not set specific tasks; send full transcript so the conductor can infer the right steward or component.
5. Never create components or call tools directly.
6. Stay silent otherwise (no natural language responses).
`;

    const toolContext: llm.ToolContext = {
      enqueue_task: llm.tool({
        description: 'Enqueue a task for the Conductor to process asynchronously.',
        parameters: z.object({
          intent: z.string().min(1),
          transcript: z.string().min(1),
          participants: z.array(z.string()).default([]),
          metadata: jsonObjectSchema.optional(),
          requestId: z.string().optional(),
          resourceKeys: z.array(z.string()).optional(),
          task: z.string().optional(),
          params: jsonObjectSchema.optional(),
        }),
        execute: async (args) => {
          const normalized = { ...args } as JsonObject;
          normalized.task = 'auto';
          if (normalized.metadata === null || typeof normalized.metadata !== 'object') {
            delete normalized.metadata;
          }
          normalized.params = {
            intent: normalized.intent,
            transcript: normalized.transcript,
            participants: normalized.participants,
            message: normalized.transcript,
            ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
          } as JsonObject;
          await enqueueTask(normalized);
          return { status: 'queued' };
        },
      }),
    };

    const realtimeModel = new openaiRealtime.RealtimeModel({
      model: 'gpt-realtime',
      toolChoice: 'required',
      inputAudioTranscription: { model: 'whisper-1' },
      turnDetection: { type: 'server_vad' },
    });

    const agent = new voice.Agent({
      instructions,
      tools: toolContext,
    });

    const session = new voice.AgentSession({
      llm: realtimeModel,
      turnDetection: 'manual' as any, // Model has server_vad enabled; session uses manual
    });

    job.room.on(RoomEvent.DataReceived, async (payload, participant, _, topic) => {
      if (topic !== 'transcription') return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        const text = typeof message?.text === 'string' ? message.text.trim() : '';
        const isManual = Boolean(message?.manual);
        const isReplay = Boolean(message?.replay);
        const speaker = typeof message?.speaker === 'string' ? message.speaker : participant?.identity;
        if (!text || isReplay) return;
        if (!isManual && speaker === 'voice-agent') return;
        await enqueueTask({
          intent: `manual_text:${text.slice(0, 64)}`,
          transcript: text,
          participants: speaker ? [speaker] : [],
          metadata: { manual: true },
        });
      } catch (error) {
        console.warn('[VoiceAgent] failed to handle manual transcription', error);
      }
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
      }
    });

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      console.error('[VoiceAgent] session error', event.error);
    });

    session.on(voice.AgentSessionEventTypes.Close, (event) => {
      console.log('[VoiceAgent] session closed', event.reason);
    });

    await session.start({
      agent,
      room: job.room,
      inputOptions: { audioEnabled: true },
      outputOptions: { audioEnabled: false, transcriptionEnabled: true },
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

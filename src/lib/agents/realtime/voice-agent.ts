import { defineAgent, JobContext, multimodal, cli, WorkerOptions, llm } from '@livekit/agents';
import { config } from 'dotenv';
import { join } from 'path';
import { z } from 'zod';

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}
import * as openai from '@livekit/agents-plugin-openai';
import { appendTranscriptCache } from '@/lib/agents/shared/supabase-context';
import { DebateJudgeManager, isStartDebate } from '@/lib/agents/debate-judge';

export default defineAgent({
  entry: async (job: JobContext) => {
    await job.connect();
    const instructions = `You are a UI automation agent. You NEVER speak—you only act by calling tools.

CRITICAL RULES:
1. For canvas work (draw, sticky note, shapes): call dispatch_to_conductor({ task: "canvas.draw", params: { instruction: "..." } })
2. For component creation/updates: call create_component or update_component
3. NEVER respond with conversational text. If uncertain, call a tool anyway.
4. Do not greet, explain, or narrate. Tool calls only.

Examples:
- User: "draw a cat" → dispatch_to_conductor({ task: "canvas.draw", params: { instruction: "draw a cat" } })
- User: "add a timer" → create_component({ type: "RetroTimerEnhanced", spec: "{}" })
- User: "hi" → (no tool needed, stay silent)

Your only output is function calls. Never use plain text unless absolutely necessary.`;

    const structuredRecord = z.object({}).catchall(z.any());

    // Define FunctionContext for tool registration
    const fncCtx: llm.FunctionContext = {
      create_component: {
        description: 'Create a new component on the canvas.',
        parameters: z.object({ type: z.string(), spec: z.string() }),
        execute: async () => {
          // No-op: actual execution happens in response_function_call_completed handler
          return { status: 'queued' };
        },
      },
      update_component: {
        description: 'Update an existing component with a patch.',
        parameters: z.object({ componentId: z.string(), patch: z.string() }),
        execute: async () => {
          return { status: 'queued' };
        },
      },
      dispatch_to_conductor: {
        description: 'Ask the conductor to run a steward for complex tasks like flowcharts or canvas drawing.',
        parameters: z.object({
          task: z.string(),
          params: structuredRecord,
        }),
        execute: async () => {
          return { status: 'queued' };
        },
      },
    };

    const model = new openai.realtime.RealtimeModel({ 
      model: 'gpt-realtime', 
      instructions, 
      modalities: ['text'],
    });
    
    console.log('[VoiceAgent] Starting agent with FunctionContext:', Object.keys(fncCtx));
    const agent = new multimodal.MultimodalAgent({ model, fncCtx, maxTextResponseRetries: Number.POSITIVE_INFINITY });
    const session = await agent.start(job.room);
    console.log('[VoiceAgent] Session started. FunctionContext:', session.fncCtx ? Object.keys(session.fncCtx) : 'NONE');
    
    // Allow text-only responses without attempting to recover to audio
    try { (session as unknown as { recoverFromTextResponse?: (itemId?: string) => void }).recoverFromTextResponse = () => {}; } catch {}

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

    session.on('response_function_call_completed', async (evt: { call_id: string; name: string; arguments: string }) => {
      try {
        const args = JSON.parse(evt.arguments || '{}');
        if (evt.name !== 'create_component' && evt.name !== 'update_component' && evt.name !== 'dispatch_to_conductor') {
          session.conversation.item.create({ type: 'function_call_output', call_id: evt.call_id, output: JSON.stringify({ status: 'ERROR', message: `Unsupported tool: ${evt.name}` }) });
          return;
        }
        const toolCallEvent = {
          id: evt.call_id,
          roomId: job.room.name || 'unknown',
          type: 'tool_call',
          payload: { tool: evt.name, params: args, context: { source: 'voice', timestamp: Date.now() } },
          timestamp: Date.now(),
          source: 'voice' as const,
        };
        await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolCallEvent)), { reliable: true, topic: 'tool_call' });
        session.conversation.item.create({ type: 'function_call_output', call_id: evt.call_id, output: JSON.stringify({ status: 'DISPATCHED' }) });
        try {
          (session as any).response?.create?.({ instructions: 'continue' });
        } catch {}
      } catch (e) {
        session.conversation.item.create({ type: 'function_call_output', call_id: evt.call_id, output: JSON.stringify({ status: 'ERROR', message: String(e) }) });
        try {
          (session as any).response?.create?.({ instructions: 'continue' });
        } catch {}
      }
    });

    session.on('input_speech_transcription_completed', async (evt: { transcript: string }) => {
      const payload = { type: 'live_transcription', text: evt.transcript, speaker: 'user', timestamp: Date.now(), is_final: true };
      await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'transcription' });
      try {
        appendTranscriptCache(job.room.name || 'unknown', {
          participantId: 'user',
          text: evt.transcript,
          timestamp: Date.now(),
        });
        void maybeHandleDebate(evt.transcript);
      } catch {}
    });

    // Mirror assistant text responses to UI transcript as well
    session.on('response_content_done', async (evt: { contentType: string; text: string; itemId: string }) => {
      try {
        if (evt.contentType === 'text' && evt.text) {
          // Guard: if model outputs JSON that looks like a tool call, convert it to an actual tool call
          const trimmed = evt.text.trim();
          if (trimmed.startsWith('{') && trimmed.includes('"task"')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.task && typeof parsed.task === 'string') {
                console.log('[VoiceAgent] Intercepted JSON tool description, converting to dispatch_to_conductor call');
                const toolCallEvent = {
                  id: `synthetic-${Date.now()}`,
                  roomId: job.room.name || 'unknown',
                  type: 'tool_call',
                  payload: {
                    tool: 'dispatch_to_conductor',
                    params: {
                      task: parsed.task,
                      params: parsed.params || {},
                    },
                    context: { source: 'voice-guard', timestamp: Date.now() },
                  },
                  timestamp: Date.now(),
                  source: 'voice' as const,
                };
                await job.room.localParticipant?.publishData(
                  new TextEncoder().encode(JSON.stringify(toolCallEvent)),
                  { reliable: true, topic: 'tool_call' },
                );
                // Don't mirror this to transcript since it's not a conversational response
                return;
              }
            } catch {
              // Not valid JSON or doesn't match pattern; treat as normal text
            }
          }
          
          const payload = { type: 'live_transcription', text: evt.text, speaker: 'voice-agent', timestamp: Date.now(), is_final: true };
          await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'transcription' });
          try {
            appendTranscriptCache(job.room.name || 'unknown', {
              participantId: 'voice-agent',
              text: evt.text,
              timestamp: Date.now(),
            });
          } catch {}
        }
      } catch {}
    });

    job.room.on('dataReceived', (data, _participant, _kind, topic) => {
      if (topic !== 'transcription') return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(data));
        if (msg?.manual === true && typeof msg.text === 'string') {
          appendTranscriptCache(job.room.name || 'unknown', {
            participantId: msg.speaker || 'user',
            text: msg.text,
            timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
          });
          try {
            session.conversation.item.create(
              new llm.ChatMessage({ role: llm.ChatRole.USER, content: String(msg.text) }),
            );
            (session as any).response.create();
          } catch (err) {
            console.error('[VoiceAgent] Failed to forward manual text to OpenAI session', err);
          }
          void maybeHandleDebate(msg.text);
        }
      } catch {}
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

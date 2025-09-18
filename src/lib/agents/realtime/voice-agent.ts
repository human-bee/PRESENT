import { defineAgent, JobContext, multimodal, cli, WorkerOptions } from '@livekit/agents';
import { config } from 'dotenv';
import { join } from 'path';

try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}
import * as openai from '@livekit/agents-plugin-openai';

export default defineAgent({
  entry: async (job: JobContext) => {
    await job.connect();
    const instructions = `You control the UI via create_component and update_component for direct manipulation, and may delegate work via dispatch_to_conductor. Keep text responses short.

TOOLS (JSON schemas):
1) create_component({ type: string, spec: string })
   - Create a new component on the canvas. 'type' is the component type, 'spec' is the initial content.
2) update_component({ componentId: string, patch: string })
   - Update an existing component with a natural-language patch or structured fields.
3) dispatch_to_conductor({ task: string, params: object })
   - Ask the conductor to run a steward/sub-agent task on your behalf.

Always return to tool calls rather than long monologues.`;
    const model = new openai.realtime.RealtimeModel({ model: 'gpt-realtime', instructions, modalities: ['text'] });
    const agent = new multimodal.MultimodalAgent({ model });
    const session = await agent.start(job.room);
    // Allow text-only responses without crashing the session
    try { (session as unknown as { recoverFromTextResponse?: () => void }).recoverFromTextResponse = () => {}; } catch {}

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
      // Debounced steward trigger example (2-4s window)
      try {
        const g: any = globalThis as any;
        clearTimeout(g.__steward_timer__);
        g.__steward_timer__ = setTimeout(async () => {
          // Emit a decision/status hint; in production, call the conductor with flowchart.update here
          const hint = { type: 'decision', payload: { decision: { should_send: true, summary: 'steward_trigger' } }, timestamp: Date.now() };
          await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(hint)), { reliable: true, topic: 'decision' });
        }, 2500);
      } catch {}
    });

    // Mirror assistant text responses to UI transcript as well
    session.on('response_content_done', async (evt: { contentType: string; text: string; itemId: string }) => {
      try {
        if (evt.contentType === 'text' && evt.text) {
          const payload = { type: 'live_transcription', text: evt.text, speaker: 'voice-agent', timestamp: Date.now(), is_final: true };
          await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic: 'transcription' });
        }
      } catch {}
    });
  },
});

// CLI runner for local dev
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('voice-agent.ts')) {
  const workerOptions = new WorkerOptions({
    agent: process.argv[1],
    agentName: 'voice-agent',
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    url: process.env.LIVEKIT_URL,
  });
  cli.runApp(workerOptions);
}



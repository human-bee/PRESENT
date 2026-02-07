import { AgentService } from '@/lib/fairy-worker/agent-service';
import type { FairyWorkerEnv, FairyUserStub } from '@/lib/fairy-worker/environment';
import type { AgentPrompt } from '@/lib/fairy-worker/types';
import { NextRequest } from 'next/server';
import { getRequestUserId } from '@/lib/supabase/server/request-user';

export const runtime = 'nodejs';

function createUserStub(): FairyUserStub {
  return {
    fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  };
}

export async function POST(request: NextRequest) {
  const bearer = await getRequestUserId(request);
  if (!bearer.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const prompt = (await request.json()) as AgentPrompt;

  const env: FairyWorkerEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    FAIRY_MODEL: process.env.FAIRY_MODEL,
    IS_LOCAL: process.env.NODE_ENV === 'production' ? 'false' : 'true',
  };

  const service = new AgentService(env);
  const encoder = new TextEncoder();
  const userStub = createUserStub();
  const userId = bearer.userId;

  const abortController = new AbortController();
  const signal = abortController.signal;

  request.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const action of service.streamActions(prompt, signal, userId, userStub)) {
          if (signal.aborted) break;
          const data = `data: ${JSON.stringify(action)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error: any) {
        const message = error?.message || 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

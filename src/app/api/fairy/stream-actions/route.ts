import { AgentService } from '@/lib/fairy-worker/agent-service';
import type { FairyWorkerEnv, FairyUserStub } from '@/lib/fairy-worker/environment';
import type { AgentPrompt } from '@/lib/fairy-worker/types';
import { NextRequest } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

export const runtime = 'nodejs';

function createUserStub(): FairyUserStub {
  return {
    fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  };
}

export async function POST(request: NextRequest) {
  const prompt = (await request.json()) as AgentPrompt;

  let userId = 'present-user';
  let env: FairyWorkerEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    FAIRY_MODEL: process.env.FAIRY_MODEL,
    IS_LOCAL: process.env.NODE_ENV === 'production' ? 'false' : 'true',
  };

  if (BYOK_ENABLED) {
    const requesterUserId = await resolveRequestUserId(request);
    if (!requesterUserId) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    userId = requesterUserId;
    const [openaiKey, anthropicKey, googleKey] = await Promise.all([
      getDecryptedUserModelKey({ userId: requesterUserId, provider: 'openai' }),
      getDecryptedUserModelKey({ userId: requesterUserId, provider: 'anthropic' }),
      getDecryptedUserModelKey({ userId: requesterUserId, provider: 'google' }),
    ]);
    env = {
      OPENAI_API_KEY: openaiKey ?? undefined,
      ANTHROPIC_API_KEY: anthropicKey ?? undefined,
      GOOGLE_API_KEY: googleKey ?? undefined,
      FAIRY_MODEL: process.env.FAIRY_MODEL,
      IS_LOCAL: 'true',
    };
  }

  const service = new AgentService(env);
  const encoder = new TextEncoder();
  const userStub = createUserStub();

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

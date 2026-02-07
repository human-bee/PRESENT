import { NextRequest, NextResponse } from 'next/server';
import { runYouTubeSteward } from '@/lib/agents/subagents/youtube-steward';
import { runYouTubeStewardOpenAI } from '@/lib/agents/subagents/youtube-steward-openai';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { instruction, context } = body;

    if (!instruction) {
      return NextResponse.json(
        { status: 'error', error: 'Missing instruction' },
        { status: 400 }
      );
    }

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
      }
      billingUserId = requesterUserId;
    }

    const usesFast = BYOK_ENABLED
      ? (billingUserId
          ? Boolean(await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' }))
          : false)
      : Boolean((process.env.CEREBRAS_API_KEY ?? '').trim());

    const action = usesFast
      ? await runYouTubeSteward({ instruction, context, ...(billingUserId ? { billingUserId } : {}) })
      : await (async () => {
          const openaiKey = BYOK_ENABLED && billingUserId
            ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'openai' })
            : (process.env.OPENAI_API_KEY ?? null);
          if (BYOK_ENABLED && !openaiKey) {
            throw new Error('BYOK_MISSING_KEY:openai');
          }
          if (!openaiKey) {
            throw new Error('OPENAI_API_KEY missing');
          }
          return await runYouTubeStewardOpenAI({ instruction, context, openaiApiKey: openaiKey });
        })();

    return NextResponse.json({ status: 'ok', action });
  } catch (error) {
    console.error('[YouTubeSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}





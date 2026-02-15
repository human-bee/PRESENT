import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { listUserModelKeyStatus } from '@/lib/agents/shared/user-model-keys';

export const runtime = 'nodejs';

type ProviderLinkState = 'linked_supported' | 'linked_unsupported' | 'api_key_configured' | 'missing';

const PROVIDERS = ['openai', 'anthropic', 'google', 'together', 'cerebras'] as const;

export async function GET(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const keyStatuses = await listUserModelKeyStatus(userId);
    const byProvider = new Map(keyStatuses.map((entry) => [entry.provider, entry]));
    const links = PROVIDERS.map((provider) => {
      const keyStatus = byProvider.get(provider);
      const state: ProviderLinkState = keyStatus?.configured ? 'api_key_configured' : 'linked_unsupported';
      return {
        provider,
        state,
        apiKeyConfigured: keyStatus?.configured ?? false,
        linked: false,
      };
    });
    return NextResponse.json({
      ok: true,
      links,
      note: 'Official subscription-credit linking requires provider OAuth/API support. Unsupported providers remain blocked-state.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load provider links' },
      { status: 500 },
    );
  }
}

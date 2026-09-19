import { NextRequest, NextResponse } from 'next/server';
import {
  listUserModelKeyStatus,
  MODEL_KEY_PROVIDERS,
} from '@/lib/agents/shared/user-model-keys';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';

export const runtime = 'nodejs';

type ProviderLinkState = 'linked_supported' | 'linked_unsupported' | 'api_key_configured' | 'missing';

export async function GET(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const keyStatuses = await listUserModelKeyStatus(userId);
    const byProvider = new Map(keyStatuses.map((entry) => [entry.provider, entry]));
    const links = MODEL_KEY_PROVIDERS.map((provider) => {
      const keyStatus = byProvider.get(provider);
      const state: ProviderLinkState = keyStatus?.configured ? 'api_key_configured' : 'missing';
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
      note: 'Official subscription-credit linking requires provider OAuth/API support. This endpoint reports whether an API key is configured.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load provider links' },
      { status: 500 },
    );
  }
}

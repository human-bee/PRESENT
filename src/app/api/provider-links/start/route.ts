import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const provider = typeof body?.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  if (!provider) {
    return NextResponse.json({ error: 'provider_required' }, { status: 400 });
  }

  return NextResponse.json(
    {
      ok: false,
      provider,
      state: 'linked_unsupported',
      message:
        'No official OAuth/API rail is configured for subscription-credit linking in this environment. Use API key mode.',
    },
    { status: 501 },
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUser } from '@/lib/supabase/server/resolve-request-user';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';
import { resolveModelControlRequestSchema } from '@/lib/agents/control-plane/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await resolveRequestUser(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = resolveModelControlRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }
  const resolved = await resolveModelControl({
    ...parsed.data,
    userId: user.id,
    allowRequestModelOverride: true,
    includeUserScope: parsed.data.includeUserScope ?? true,
  });
  return NextResponse.json({ ok: true, resolved });
}

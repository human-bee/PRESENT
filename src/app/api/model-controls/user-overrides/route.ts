import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { z } from 'zod';
import { modelControlPatchSchema } from '@/lib/agents/control-plane/schemas';
import { upsertModelControlProfile } from '@/lib/agents/control-plane/profiles';
import { clearModelControlResolverCache } from '@/lib/agents/control-plane/resolver';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

const UserOverrideSchema = z
  .object({
    config: modelControlPatchSchema,
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export async function PUT(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = UserOverrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }
  const profile = await upsertModelControlProfile({
    input: {
      scopeType: 'user',
      scopeId: userId,
      taskPrefix: null,
      enabled: parsed.data.enabled ?? true,
      priority: parsed.data.priority ?? 100,
      config: parsed.data.config,
    },
    actorUserId: userId,
  });
  clearModelControlResolverCache();
  void recordOpsAudit({
    actorUserId: userId,
    action: 'model_controls.user_override_upsert',
    reason: 'Updated user-scoped model/knob overrides',
    afterStatus: 'ok',
    result: {
      scopeType: 'user',
      scopeId: userId,
      profileId: profile.id,
      version: profile.version,
    },
  });
  return NextResponse.json({ ok: true, profile });
}


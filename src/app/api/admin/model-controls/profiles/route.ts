import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import { listModelControlProfiles, upsertModelControlProfile } from '@/lib/agents/control-plane/profiles';
import { knobScopeSchema, modelControlProfileUpsertSchema } from '@/lib/agents/control-plane/schemas';
import { clearModelControlResolverCache } from '@/lib/agents/control-plane/resolver';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminActionUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const scopeTypeRaw = req.nextUrl.searchParams.get('scopeType');
  const scopeId = req.nextUrl.searchParams.get('scopeId') || undefined;
  const task = req.nextUrl.searchParams.get('task') || undefined;
  const scopeType = scopeTypeRaw ? knobScopeSchema.safeParse(scopeTypeRaw) : null;
  if (scopeTypeRaw && !scopeType?.success) {
    return NextResponse.json({ error: 'invalid_scope_type' }, { status: 400 });
  }
  const profiles = await listModelControlProfiles({
    scopeType: scopeType?.success ? scopeType.data : undefined,
    scopeId,
    task,
  });
  return NextResponse.json({ ok: true, profiles });
}

export async function POST(req: NextRequest) {
  const admin = await requireAgentAdminActionUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = modelControlProfileUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }
  let profile: Awaited<ReturnType<typeof upsertModelControlProfile>>;
  try {
    profile = await upsertModelControlProfile({
      input: parsed.data,
      actorUserId: admin.userId,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('MODEL_CONTROL_PROFILE_VERSION_CONFLICT')) {
      return NextResponse.json({ error: 'version_conflict' }, { status: 409 });
    }
    throw error;
  }
  clearModelControlResolverCache();
  void recordOpsAudit({
    actorUserId: admin.userId,
    action: 'model_controls.admin_profile_upsert',
    reason: `Updated ${profile.scope_type} model-control profile`,
    afterStatus: 'ok',
    result: {
      profileId: profile.id,
      scopeType: profile.scope_type,
      scopeId: profile.scope_id,
      taskPrefix: profile.task_prefix,
      version: profile.version,
    },
  });
  return NextResponse.json({ ok: true, profile });
}

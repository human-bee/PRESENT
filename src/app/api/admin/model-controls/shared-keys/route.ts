import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import { sharedKeyUpsertSchema } from '@/lib/agents/control-plane/schemas';
import {
  deleteSharedModelKey,
  listSharedKeyStatus,
  upsertSharedModelKey,
} from '@/lib/agents/control-plane/shared-keys';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminActionUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const keys = await listSharedKeyStatus();
  return NextResponse.json({ ok: true, keys });
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
  const parsed = sharedKeyUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }
  const payload = parsed.data;
  if (payload.delete) {
    await deleteSharedModelKey({ provider: payload.provider });
    void recordOpsAudit({
      actorUserId: admin.userId,
      action: 'model_controls.admin_shared_key_delete',
      reason: `Deleted shared key for provider ${payload.provider}`,
      afterStatus: 'ok',
      result: { provider: payload.provider },
    });
    return NextResponse.json({ ok: true, provider: payload.provider, deleted: true });
  }
  const result = await upsertSharedModelKey({
    provider: payload.provider,
    apiKey: payload.apiKey!,
    enabled: payload.enabled,
    actorUserId: admin.userId,
  });
  void recordOpsAudit({
    actorUserId: admin.userId,
    action: 'model_controls.admin_shared_key_upsert',
    reason: `Upserted shared key for provider ${payload.provider}`,
    afterStatus: 'ok',
    result: {
      provider: payload.provider,
      enabled: payload.enabled ?? true,
      last4: result.last4,
    },
  });
  return NextResponse.json({ ok: true, ...result });
}

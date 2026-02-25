import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import { sharedKeyPasswordSchema } from '@/lib/agents/control-plane/schemas';
import { getSharedKeyringPolicy, setSharedKeyringPassword } from '@/lib/agents/control-plane/shared-keys';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminActionUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const policy = await getSharedKeyringPolicy();
  return NextResponse.json({
    ok: true,
    policy: {
      passwordRequired: policy.password_required,
      updatedAt: policy.updated_at,
    },
  });
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
  const parsed = sharedKeyPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await setSharedKeyringPassword({
    password: parsed.data.password,
    required: parsed.data.required,
    actorUserId: admin.userId,
  });
  void recordOpsAudit({
    actorUserId: admin.userId,
    action: 'model_controls.admin_shared_key_password_update',
    reason: result.passwordRequired
      ? 'Updated shared keyring unlock password policy'
      : 'Cleared shared keyring unlock password policy',
    afterStatus: 'ok',
    result: {
      passwordRequired: result.passwordRequired,
    },
  });
  return NextResponse.json({
    ok: true,
    policy: result,
  });
}


import { NextRequest, NextResponse } from 'next/server';
import { flags } from '@/lib/feature-flags';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import { parseAgentActionInput, runAgentSafeAction } from '@/lib/agents/admin/actions';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await requireAgentAdminActionUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  if (!flags.agentAdminActionsEnabled) {
    return NextResponse.json({ error: 'actions_disabled' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = parseAgentActionInput(body);
    const result = await runAgentSafeAction({
      actorUserId: admin.userId,
      action: parsed.action,
      targetTaskId: parsed.targetTaskId,
      reason: parsed.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to apply action';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

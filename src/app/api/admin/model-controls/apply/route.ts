import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import { getModelControlApplyConfig } from '@/lib/agents/control-plane/apply-config';
import { getApplyServices, runApplyService } from '@/lib/agents/control-plane/apply-runtime';
import { clearModelControlResolverCache } from '@/lib/agents/control-plane/resolver';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

const ApplySchema = z
  .object({
    reason: z.string().trim().min(1).max(300).optional(),
    targetConfigVersion: z.string().trim().min(3).max(120).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const admin = await requireAgentAdminActionUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }

  clearModelControlResolverCache();
  const requestedAt = new Date().toISOString();
  const reason =
    parsed.data.reason ||
    'Applied model-control config update; restart-required services should be redeployed by deployment workflow.';

  try {
    getModelControlApplyConfig();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'invalid_apply_configuration', detail }, { status: 500 });
  }

  const stepResults = await Promise.all(getApplyServices().map(async (service) => runApplyService(service)));

  void recordOpsAudit({
    actorUserId: admin.userId,
    action: 'model_controls.admin_apply',
    reason,
    afterStatus: stepResults.some((step) => step.status === 'failed') ? 'partial_failure' : 'accepted',
    result: {
      targetConfigVersion: parsed.data.targetConfigVersion ?? null,
      requestedAt,
      steps: stepResults,
    },
  });

  const hasFailures = stepResults.some((step) => step.status === 'failed');
  return NextResponse.json(
    {
      ok: !hasFailures,
      apply: {
        requestedAt,
        targetConfigVersion: parsed.data.targetConfigVersion ?? null,
        steps: stepResults,
        note: 'Apply targets were dispatched directly via provider adapters; missing settings are reported as skipped_unconfigured.',
      },
    },
    { status: hasFailures ? 502 : 200 },
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAgentAdminActionUserId } from '@/lib/agents/admin/auth';
import { clearModelControlResolverCache } from '@/lib/agents/control-plane/resolver';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';
const APPLY_TIMEOUT_MS = 20_000;

const ApplySchema = z
  .object({
    reason: z.string().trim().min(1).max(300).optional(),
    targetConfigVersion: z.string().trim().min(3).max(120).optional(),
  })
  .strict();

type ApplyServiceName = 'vercel_web' | 'railway_conductor' | 'railway_realtime';
type ApplyStepStatus = 'applied' | 'failed' | 'skipped_unconfigured';

type ApplyStepResult = {
  service: ApplyServiceName;
  status: ApplyStepStatus;
  detail?: string;
};

const APPLY_TARGETS: Array<{ service: ApplyServiceName; webhookEnv: string }> = [
  { service: 'vercel_web', webhookEnv: 'MODEL_CONTROL_APPLY_VERCEL_WEBHOOK_URL' },
  { service: 'railway_conductor', webhookEnv: 'MODEL_CONTROL_APPLY_RAILWAY_CONDUCTOR_WEBHOOK_URL' },
  { service: 'railway_realtime', webhookEnv: 'MODEL_CONTROL_APPLY_RAILWAY_REALTIME_WEBHOOK_URL' },
];

const callApplyWebhook = async (params: {
  service: ApplyServiceName;
  url: string;
  actorUserId: string;
  reason: string;
  targetConfigVersion: string | null;
  requestedAt: string;
}): Promise<ApplyStepResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APPLY_TIMEOUT_MS);
  try {
    const response = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'model-controls',
        service: params.service,
        actorUserId: params.actorUserId,
        reason: params.reason,
        targetConfigVersion: params.targetConfigVersion,
        requestedAt: params.requestedAt,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        service: params.service,
        status: 'failed',
        detail: `HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`,
      };
    }
    return {
      service: params.service,
      status: 'applied',
    };
  } catch (error) {
    return {
      service: params.service,
      status: 'failed',
      detail: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    };
  } finally {
    clearTimeout(timeout);
  }
};

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
  const stepResults = await Promise.all(
    APPLY_TARGETS.map(async (target): Promise<ApplyStepResult> => {
      const webhookUrl = process.env[target.webhookEnv]?.trim();
      if (!webhookUrl) {
        return {
          service: target.service,
          status: 'skipped_unconfigured',
          detail: `Missing ${target.webhookEnv}`,
        };
      }
      return callApplyWebhook({
        service: target.service,
        url: webhookUrl,
        actorUserId: admin.userId,
        reason,
        targetConfigVersion: parsed.data.targetConfigVersion ?? null,
        requestedAt,
      });
    }),
  );
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
  return NextResponse.json({
    ok: !hasFailures,
    apply: {
      requestedAt,
      targetConfigVersion: parsed.data.targetConfigVersion ?? null,
      steps: stepResults,
      note: 'Configured apply webhooks were called; unconfigured services are reported as skipped_unconfigured.',
    },
  }, { status: hasFailures ? 502 : 200 });
}

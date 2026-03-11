import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { registerExecutorSession } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../../_lib/persistence';

export const runtime = 'nodejs';

const registerSchema = z.object({
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  kind: z.enum(['local_companion', 'hosted_executor', 'room_worker', 'browser_client']),
  authMode: z.enum(['chatgpt', 'api_key', 'shared_key', 'byok']),
  codexBaseUrl: z.string().optional(),
  capabilities: z
    .array(
      z.enum([
        'code_edit',
        'code_review',
        'canvas_edit',
        'widget_render',
        'room_presence',
        'voice_realtime',
        'mcp_server',
        'mcp_client',
      ]),
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  await hydrateResetKernel();
  const payload = registerSchema.parse(await request.json());
  const executorSession = registerExecutorSession(payload);
  await flushResetKernelWrites();
  return NextResponse.json({ executorSession }, { status: 201 });
}

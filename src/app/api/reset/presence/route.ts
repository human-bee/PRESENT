import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listPresenceMembers, setPresenceMemberState, upsertPresenceMember } from '@present/kernel';
import { jsonObjectSchema } from '@present/contracts';
import { flushResetKernelWrites, hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

const upsertPresenceSchema = z.object({
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  displayName: z.string().min(1),
  state: z.enum(['connected', 'idle', 'away', 'offline']),
  media: z
    .object({
      audio: z.boolean().optional(),
      video: z.boolean().optional(),
      screen: z.boolean().optional(),
    })
    .optional(),
  metadata: jsonObjectSchema.optional(),
});

const updateStateSchema = z.object({
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  state: z.enum(['connected', 'idle', 'away', 'offline']),
});

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ presence: listPresenceMembers(workspaceSessionId) });
}

export async function POST(request: NextRequest) {
  await hydrateResetKernel();
  const payload =
    typeof request.text === 'function'
      ? (() => request.text().then((rawBody) => (rawBody.trim() ? JSON.parse(rawBody) : null)))()
      : request.json();
  const parsedPayload = await payload;
  if (!parsedPayload) {
    return NextResponse.json({ ignored: true }, { status: 202 });
  }
  if (parsedPayload?.displayName) {
    const presenceMember = upsertPresenceSchema.parse(parsedPayload);
    const response = NextResponse.json({
      presenceMember: upsertPresenceMember({
        ...presenceMember,
        media: {
          audio: presenceMember.media?.audio ?? false,
          video: presenceMember.media?.video ?? false,
          screen: presenceMember.media?.screen ?? false,
        },
      }),
    });
    await flushResetKernelWrites();
    return response;
  }

  const stateUpdate = updateStateSchema.parse(parsedPayload);
  const presenceMember = setPresenceMemberState(
    stateUpdate.workspaceSessionId,
    stateUpdate.identity,
    stateUpdate.state,
  );
  if (!presenceMember) {
    return NextResponse.json({ error: 'Presence member not found' }, { status: 404 });
  }
  await flushResetKernelWrites();
  return NextResponse.json({ presenceMember });
}

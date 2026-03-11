import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listPresenceMembers, setPresenceMemberState, upsertPresenceMember } from '@present/kernel';
import { jsonObjectSchema } from '@present/contracts';

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
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ presence: listPresenceMembers(workspaceSessionId) });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  if (payload?.displayName) {
    const presenceMember = upsertPresenceSchema.parse(payload);
    return NextResponse.json({
      presenceMember: upsertPresenceMember({
        ...presenceMember,
        media: {
          audio: presenceMember.media?.audio ?? false,
          video: presenceMember.media?.video ?? false,
          screen: presenceMember.media?.screen ?? false,
        },
      }),
    });
  }

  const stateUpdate = updateStateSchema.parse(payload);
  const presenceMember = setPresenceMemberState(
    stateUpdate.workspaceSessionId,
    stateUpdate.identity,
    stateUpdate.state,
  );
  if (!presenceMember) {
    return NextResponse.json({ error: 'Presence member not found' }, { status: 404 });
  }
  return NextResponse.json({ presenceMember });
}

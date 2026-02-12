import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import {
  deleteUserModelKey,
  listUserModelKeyStatus,
  modelKeyProviderSchema,
  upsertUserModelKey,
} from '@/lib/agents/shared/user-model-keys';

export const runtime = 'nodejs';

const PostSchema = z.object({
  provider: modelKeyProviderSchema,
  apiKey: z.string().min(8).max(512),
});

const DeleteSchema = z.object({
  provider: modelKeyProviderSchema,
});

function byokDisabled() {
  return NextResponse.json({ error: 'byok_disabled' }, { status: 404 });
}

async function requireUserId(req: NextRequest): Promise<string | null> {
  const userId = await resolveRequestUserId(req);
  if (!userId) return null;
  return userId;
}

export async function GET(req: NextRequest) {
  if (!BYOK_ENABLED) return byokDisabled();

  const userId = await requireUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const keys = await listUserModelKeyStatus(userId);
    return NextResponse.json({ ok: true, keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load keys';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!BYOK_ENABLED) return byokDisabled();

  const userId = await requireUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const res = await upsertUserModelKey({
      userId,
      provider: parsed.data.provider,
      plaintextKey: parsed.data.apiKey,
    });
    return NextResponse.json({ ok: true, provider: res.provider, last4: res.last4 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save key';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!BYOK_ENABLED) return byokDisabled();

  const userId = await requireUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // allow DELETE without body in some clients
    body = null;
  }

  const provider =
    typeof (body as any)?.provider === 'string'
      ? (body as any).provider
      : new URL(req.url).searchParams.get('provider');

  const parsed = DeleteSchema.safeParse({ provider });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await deleteUserModelKey({ userId, provider: parsed.data.provider });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete key';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


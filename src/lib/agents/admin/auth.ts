import type { NextRequest } from 'next/server';
import { parseCsvFlag } from '@/lib/feature-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';

export function getAgentAdminAllowlistUserIds(): string[] {
  return parseCsvFlag(process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS);
}

export async function requireAgentAdminUserId(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  const allowlist = getAgentAdminAllowlistUserIds();
  if (allowlist.length === 0) {
    return { ok: false, status: 403, error: 'admin_allowlist_not_configured' };
  }
  if (!allowlist.includes(userId)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true, userId };
}

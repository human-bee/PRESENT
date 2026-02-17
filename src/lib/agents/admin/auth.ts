import type { NextRequest } from 'next/server';
import { parseCsvFlag } from '@/lib/feature-flags';
import { resolveRequestUser } from '@/lib/supabase/server/resolve-request-user';

export function getAgentAdminAllowlistUserIds(): string[] {
  return parseCsvFlag(process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS);
}

export async function requireAgentAdminUserId(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const user = await resolveRequestUser(req);
  if (!user?.id) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  const allowlist = getAgentAdminAllowlistUserIds();
  if (allowlist.length === 0) {
    return { ok: false, status: 403, error: 'admin_allowlist_not_configured' };
  }
  const normalizedAllowlist = new Set(allowlist.map((entry) => entry.trim().toLowerCase()));
  const allowedById = normalizedAllowlist.has(user.id.toLowerCase());
  const allowedByEmail =
    typeof user.email === 'string' &&
    user.email.trim().length > 0 &&
    normalizedAllowlist.has(user.email.trim().toLowerCase());
  if (!allowedById && !allowedByEmail) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true, userId: user.id };
}

import type { NextRequest } from 'next/server';
import { getBooleanFlag, parseCsvFlag } from '@/lib/feature-flags';
import { resolveRequestUser } from '@/lib/supabase/server/resolve-request-user';

export type AgentAdminAccessMode = 'allowlist' | 'open_access';

type AgentAdminAuthResult =
  | { ok: true; userId: string; mode: AgentAdminAccessMode }
  | { ok: false; status: number; error: string };

export function getAgentAdminAllowlistUserIds(): string[] {
  return parseCsvFlag(process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS);
}

export function isAgentAdminAuthenticatedOpenAccessEnabled(): boolean {
  return getBooleanFlag(process.env.AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS, false);
}

export function isAgentAdminPublicReadAccessEnabled(): boolean {
  return getBooleanFlag(process.env.AGENT_ADMIN_PUBLIC_READ_ACCESS, false);
}

export function isAgentAdminDetailSignedInRequiredEnabled(): boolean {
  return getBooleanFlag(process.env.AGENT_ADMIN_DETAIL_SIGNED_IN_REQUIRED, true);
}

export function isAgentAdminDetailGlobalScopeEnabled(): boolean {
  return getBooleanFlag(process.env.AGENT_ADMIN_DETAIL_GLOBAL_SCOPE, true);
}

export function isAgentAdminDetailMaskDefaultEnabled(): boolean {
  return getBooleanFlag(process.env.AGENT_ADMIN_DETAIL_MASK_DEFAULT, true);
}

const isAllowlistedUser = (allowlist: Set<string>, userId: string, email: string | null): boolean => {
  const allowedById = allowlist.has(userId.toLowerCase());
  const allowedByEmail =
    typeof email === 'string' && email.trim().length > 0 && allowlist.has(email.trim().toLowerCase());
  return allowedById || allowedByEmail;
};

async function requireAgentAdminUser(
  req: NextRequest,
  options: { allowOpenAccess: boolean },
): Promise<AgentAdminAuthResult> {
  const user = await resolveRequestUser(req);
  if (!user?.id) {
    if (options.allowOpenAccess && isAgentAdminPublicReadAccessEnabled()) {
      return { ok: true, userId: 'anonymous', mode: 'open_access' };
    }
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const allowlist = getAgentAdminAllowlistUserIds();
  const normalizedAllowlist = new Set(allowlist.map((entry) => entry.trim().toLowerCase()));
  if (isAllowlistedUser(normalizedAllowlist, user.id, user.email)) {
    return { ok: true, userId: user.id, mode: 'allowlist' };
  }

  if (options.allowOpenAccess && isAgentAdminAuthenticatedOpenAccessEnabled()) {
    return { ok: true, userId: user.id, mode: 'open_access' };
  }

  if (allowlist.length === 0) {
    return { ok: false, status: 403, error: 'admin_allowlist_not_configured' };
  }

  return { ok: false, status: 403, error: 'forbidden' };
}

export async function requireAgentAdminUserId(
  req: NextRequest,
): Promise<AgentAdminAuthResult> {
  return requireAgentAdminUser(req, { allowOpenAccess: true });
}

export async function requireAgentAdminSignedInUserId(
  req: NextRequest,
): Promise<AgentAdminAuthResult> {
  const result = await requireAgentAdminUser(req, { allowOpenAccess: true });
  if (!result.ok) return result;
  if (isAgentAdminDetailSignedInRequiredEnabled() && result.userId === 'anonymous') {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return result;
}

export async function requireAgentAdminActionUserId(
  req: NextRequest,
): Promise<AgentAdminAuthResult> {
  return requireAgentAdminUser(req, { allowOpenAccess: false });
}

import type { JsonObject } from '@/lib/utils/json-schema';

const LIVEKIT_SCOPE_ENV_KEYS = [
  'AGENT_RUNTIME_SCOPE',
  'LIVEKIT_REST_URL',
  'LIVEKIT_URL',
  'NEXT_PUBLIC_LK_SERVER_URL',
  'NEXT_PUBLIC_LIVEKIT_URL',
  'LIVEKIT_HOST',
] as const;

const normalizeHostPort = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const noProtocol = trimmed.replace(/^(?:https?|wss?|tcp):\/\//i, '');
  const hostPort = noProtocol.split('/')[0]?.trim().toLowerCase() ?? '';
  if (!hostPort) return null;
  return hostPort;
};

export const normalizeRuntimeScope = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const raw = trimmed.startsWith('ws://')
    ? `http://${trimmed.slice('ws://'.length)}`
    : trimmed.startsWith('wss://')
      ? `https://${trimmed.slice('wss://'.length)}`
      : trimmed;

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) return normalizeHostPort(trimmed);
    const port = parsed.port.trim();
    return port ? `${host}:${port}` : host;
  } catch {
    return normalizeHostPort(trimmed);
  }
};

export const resolveRuntimeScopeFromEnv = (
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | null => {
  for (const key of LIVEKIT_SCOPE_ENV_KEYS) {
    const normalized = normalizeRuntimeScope(env[key]);
    if (normalized) return normalized;
  }
  return null;
};

const readObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const extractRuntimeScopeFromParams = (params: JsonObject | null | undefined): string | null => {
  if (!params || typeof params !== 'object') return null;
  const direct = normalizeRuntimeScope((params as Record<string, unknown>).runtimeScope);
  if (direct) return direct;
  const metadata = readObject((params as Record<string, unknown>).metadata);
  if (!metadata) return null;
  return (
    normalizeRuntimeScope(metadata.runtimeScope) ??
    normalizeRuntimeScope(metadata.runtime_scope) ??
    null
  );
};

const sanitizeResourceToken = (value: string): string => {
  const lowered = value.trim().toLowerCase();
  if (!lowered) return 'unknown';
  return lowered.replace(/[^a-z0-9._:-]+/g, '-');
};

export const normalizeWorkerHostIdentity = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname = trimmed;
  try {
    const parsed = new URL(withProtocol);
    hostname = parsed.hostname.trim().toLowerCase();
  } catch {
    hostname = trimmed.split('/')[0]?.trim().toLowerCase() ?? '';
    const colonIndex = hostname.indexOf(':');
    if (colonIndex > 0) hostname = hostname.slice(0, colonIndex);
  }
  if (!hostname) return null;
  const withoutTrailingDots = hostname.replace(/\.+$/g, '');
  if (!withoutTrailingDots) return null;
  if (withoutTrailingDots.endsWith('.local')) {
    return withoutTrailingDots.slice(0, -'.local'.length);
  }
  return withoutTrailingDots;
};

export const areWorkerHostsEquivalent = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizeWorkerHostIdentity(left);
  const normalizedRight = normalizeWorkerHostIdentity(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const leftShort = normalizedLeft.split('.')[0] ?? normalizedLeft;
  const rightShort = normalizedRight.split('.')[0] ?? normalizedRight;
  return leftShort.length > 0 && leftShort === rightShort;
};

export const getRuntimeScopeResourceKey = (scope: string | null | undefined): string | null => {
  const normalized = normalizeRuntimeScope(scope);
  if (!normalized) return null;
  return `runtime-scope:${sanitizeResourceToken(normalized)}`;
};

export const hasRuntimeScopeMismatch = (
  taskScope: string | null | undefined,
  workerScope: string | null | undefined,
): boolean => {
  const normalizedTaskScope = normalizeRuntimeScope(taskScope);
  if (!normalizedTaskScope) return false;
  const normalizedWorkerScope = normalizeRuntimeScope(workerScope);
  return !normalizedWorkerScope || normalizedTaskScope !== normalizedWorkerScope;
};

export const isLocalRuntimeScope = (scope: string | null | undefined): boolean => {
  const normalized = normalizeRuntimeScope(scope);
  if (!normalized) return false;
  const host = normalized.split(':')[0] ?? normalized;
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  return host === 'local' || host.startsWith('local-');
};

export const getWorkerHostSkipResourceKey = (host: string): string => {
  const normalized = normalizeWorkerHostIdentity(host);
  return `skip-host:${sanitizeResourceToken(normalized ?? host)}`;
};

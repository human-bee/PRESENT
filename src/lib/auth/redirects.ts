const DEFAULT_POST_AUTH_PATH = '/canvas';

export function sanitizeInternalRedirectPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_POST_AUTH_PATH;
  if (!next.startsWith('/')) return DEFAULT_POST_AUTH_PATH;
  if (next.startsWith('//')) return DEFAULT_POST_AUTH_PATH;
  return next;
}

export function buildAuthPageHref(
  page: 'signin' | 'signup',
  next: string | null | undefined,
): string {
  const safeNext = sanitizeInternalRedirectPath(next);
  const basePath = `/auth/${page}`;
  if (safeNext === DEFAULT_POST_AUTH_PATH) return basePath;
  return `${basePath}?next=${encodeURIComponent(safeNext)}`;
}

export function getCurrentPathWithSearchAndHash(): string {
  if (typeof window === 'undefined') return DEFAULT_POST_AUTH_PATH;
  return sanitizeInternalRedirectPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export { DEFAULT_POST_AUTH_PATH };

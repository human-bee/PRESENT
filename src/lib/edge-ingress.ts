const normalizePath = (path: string) => {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
};

const normalizeBase = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
};

export function isEdgeIngressEnabled(): boolean {
  if (typeof window !== 'undefined') {
    return (process.env.NEXT_PUBLIC_EDGE_INGRESS_ENABLED ?? 'false') === 'true';
  }
  return (
    (process.env.EDGE_INGRESS_ENABLED ?? process.env.NEXT_PUBLIC_EDGE_INGRESS_ENABLED ?? 'false') ===
    'true'
  );
}

export function getEdgeIngressBaseUrl(): string | null {
  if (typeof window !== 'undefined') {
    return normalizeBase(process.env.NEXT_PUBLIC_EDGE_INGRESS_URL || '');
  }
  return normalizeBase(process.env.EDGE_INGRESS_URL || process.env.NEXT_PUBLIC_EDGE_INGRESS_URL || '');
}

export function resolveEdgeIngressUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  if (!isEdgeIngressEnabled()) return normalizedPath;
  const base = getEdgeIngressBaseUrl();
  if (!base) return normalizedPath;
  return new URL(normalizedPath, base).toString();
}

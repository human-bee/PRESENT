const LEGACY_CANVAS_PATHNAME = '/canvas';
const LEGACY_CANVAS_QUERY_KEYS = ['id', 'room', 'share', 'fresh', 'legacy'] as const;

export function buildLegacyCanvasInviteLink(origin: string, roomName: string): string {
  const url = new URL(LEGACY_CANVAS_PATHNAME, origin);
  url.searchParams.set('room', roomName);
  return url.toString();
}

function shouldCanonicalizeLegacyCanvasUrl(url: URL): boolean {
  if (url.pathname !== '/') {
    return false;
  }

  return LEGACY_CANVAS_QUERY_KEYS.some((key) => url.searchParams.has(key));
}

export function canonicalizeLegacyCanvasHref(href: string): string | null {
  const url = new URL(href);
  if (!shouldCanonicalizeLegacyCanvasUrl(url)) {
    return null;
  }

  url.pathname = LEGACY_CANVAS_PATHNAME;
  return url.toString();
}

export function canonicalizeLegacyCanvasPathAndQuery(
  pathname: string,
  searchParams: URLSearchParams,
): string | null {
  const url = new URL(`https://present.best${pathname}`);
  url.search = searchParams.toString();
  const canonicalHref = canonicalizeLegacyCanvasHref(url.toString());
  if (!canonicalHref) return null;
  const canonicalUrl = new URL(canonicalHref);
  return `${canonicalUrl.pathname}${canonicalUrl.search}`;
}

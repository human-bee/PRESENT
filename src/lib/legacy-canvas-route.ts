const LEGACY_CANVAS_PATHNAME = '/canvas';

export function buildLegacyCanvasInviteLink(origin: string, roomName: string): string {
  const url = new URL(LEGACY_CANVAS_PATHNAME, origin);
  url.searchParams.set('room', roomName);
  return url.toString();
}

export function canonicalizeLegacyCanvasHref(href: string): string | null {
  const url = new URL(href);
  if (url.pathname !== '/') {
    return null;
  }

  url.pathname = LEGACY_CANVAS_PATHNAME;
  return url.toString();
}

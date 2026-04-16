import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { canonicalizeLegacyCanvasPathAndQuery } from '@/lib/legacy-canvas-route';

const LEGACY_PATH_PREFIXES = [
  '/canvas',
  '/canvases',
  '/mcp-config',
  '/showcase/ui',
  '/api/agent',
  '/api/canvas',
  '/api/canvas-agent',
  '/api/session',
  '/api/steward',
];

const isLegacyPath = (pathname: string) =>
  LEGACY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function proxy(request: NextRequest) {
  const canonicalLegacyCanvasPath = canonicalizeLegacyCanvasPathAndQuery(
    request.nextUrl.pathname,
    request.nextUrl.searchParams,
  );
  if (canonicalLegacyCanvasPath) {
    const redirectUrl = new URL(canonicalLegacyCanvasPath, request.url);
    return NextResponse.redirect(redirectUrl, 307);
  }

  const response = NextResponse.next();
  if (isLegacyPath(request.nextUrl.pathname)) {
    response.headers.set('x-present-runtime', 'legacy-archive');
    response.headers.set('x-present-entrypoint', '/');
    response.headers.set('x-robots-tag', 'noindex');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json).*)'],
};

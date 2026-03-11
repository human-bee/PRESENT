import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

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

const isLegacyPath = (pathname: string) => LEGACY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function middleware(request: NextRequest) {
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

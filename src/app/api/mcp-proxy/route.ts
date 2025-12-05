import { NextRequest } from 'next/server';

// --- Simple streaming proxy for MCP servers --------------------------------
// Browsers block direct fetches to many public MCP servers because they do not
// include an `Access-Control-Allow-Origin` header. We work around this by
// proxying the request through our own Next.js server (same origin as the
// frontend).
// Usage from the browser:
//   fetch(`/api/mcp-proxy?target=${encodeURIComponent('https://server.smithery.ai/exa/mcp?api_key=xxx')}`)
// The proxy forwards the request, streams back the response body (important
// for SSE connections) and appends permissive CORS headers.
// ---------------------------------------------------------------------------

export const runtime = 'edge'; // Enable edge runtime for lower latency streams

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

async function forward(request: NextRequest, targetUrl: string): Promise<Response> {
  try {
    // Parse the target URL to preserve query parameters
    const url = new URL(targetUrl);

    // Merge any additional query params from the proxy request
    // (but don't override params already in the target URL)
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'target' && !url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    });

    const init: RequestInit = {
      method: request.method,
      // Forward headers except Host so the upstream sees correct origin
      headers: Object.fromEntries(
        [...request.headers.entries()].filter(([key]) => key.toLowerCase() !== 'host'),
      ),
      // For non-GET methods pass the body through
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
      cache: 'no-store', // Disable caching for SSE/API proxy
      // @ts-ignore - duplex is required for streaming bodies in some environments but not in all TS definitions
      duplex: 'half',
    };

    console.log('[MCP Proxy] Forwarding to:', url.toString());
    const upstream = await fetch(url.toString(), init);
    console.log('[MCP Proxy] Upstream status:', upstream.status);

    // Stream the body directly so we support Server-Sent Events (text/event-stream)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...Object.fromEntries(upstream.headers.entries()),
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error('[MCP Proxy] Error forwarding request:', error);
    return new Response(
      JSON.stringify({
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target');
  if (!target) {
    return new Response('Missing "target" query parameter', { status: 400, headers: CORS_HEADERS });
  }

  // Validate the target URL
  try {
    new URL(target);
  } catch {
    return new Response('Invalid target URL', { status: 400, headers: CORS_HEADERS });
  }

  return forward(req, target);
}

export async function POST(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target');
  if (!target) {
    return new Response('Missing "target" query parameter', { status: 400, headers: CORS_HEADERS });
  }

  // Validate the target URL
  try {
    new URL(target);
  } catch {
    return new Response('Invalid target URL', { status: 400, headers: CORS_HEADERS });
  }

  return forward(req, target);
}

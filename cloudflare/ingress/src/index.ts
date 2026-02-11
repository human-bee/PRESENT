export interface Env {
  ORIGIN_BASE_URL: string;
  EDGE_ALLOWED_ORIGINS?: string;
  EDGE_INGRESS_SHARED_SECRET?: string;
}

const ALLOWED_PATHS = new Set<string>([
  '/api/token',
  '/api/mcp-proxy',
  '/api/canvas-agent/ack',
  '/api/canvas-agent/screenshot',
  '/api/canvas-agent/viewport',
]);

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function normalizeOriginList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.has(pathname);
}

function resolveAllowedOrigin(requestOrigin: string | null, env: Env): string {
  const allowed = normalizeOriginList(env.EDGE_ALLOWED_ORIGINS);
  if (!requestOrigin) return '*';
  if (allowed.length === 0) return requestOrigin;
  if (allowed.includes('*')) return requestOrigin;
  return allowed.includes(requestOrigin) ? requestOrigin : 'null';
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = resolveAllowedOrigin(request.headers.get('origin'), env);
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Timestamp, X-Nonce, X-Signature, Last-Event-ID, MCP-Session-Id, X-MCP-Upstream-Authorization',
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
  };
}

function buildForwardHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith('cf-')) continue;
    headers.set(key, value);
  }
  if (env.EDGE_INGRESS_SHARED_SECRET) {
    headers.set('x-edge-ingress-secret', env.EDGE_INGRESS_SHARED_SECRET);
  }
  return headers;
}

function mergeResponseHeaders(
  upstream: Headers,
  cors: Record<string, string>,
  passthroughContentType = true,
): Headers {
  const headers = new Headers();
  upstream.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'set-cookie') return;
    if (!passthroughContentType && lower === 'content-type') return;
    headers.set(key, value);
  });
  Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
  headers.set('Cache-Control', 'no-store');
  headers.set('x-edge-ingress', 'cloudflare');
  return headers;
}

function badRequest(message: string, request: Request, env: Env, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request, env),
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.ORIGIN_BASE_URL?.trim()) {
      return badRequest('Missing ORIGIN_BASE_URL', request, env, 500);
    }

    const requestUrl = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!isAllowedPath(requestUrl.pathname)) {
      return badRequest('Path not allowed', request, env, 404);
    }

    let originBase: URL;
    try {
      originBase = new URL(env.ORIGIN_BASE_URL);
    } catch {
      return badRequest('Invalid ORIGIN_BASE_URL', request, env, 500);
    }

    const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, originBase);
    const forwardHeaders = buildForwardHeaders(request, env);
    const cors = corsHeaders(request, env);

    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
        // @ts-expect-error duplex is required for streaming request bodies.
        duplex: 'half',
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: mergeResponseHeaders(upstream.headers, cors),
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Upstream proxy failure',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            ...cors,
            'Cache-Control': 'no-store',
            'x-edge-ingress': 'cloudflare',
          },
        },
      );
    }
  },
};

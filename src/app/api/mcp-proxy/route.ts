import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserId } from '@/lib/supabase/server/request-user';
import { acquireConcurrencySlot, consumeWindowedLimit } from '@/lib/server/traffic-guards';

export const runtime = 'edge';

const DEFAULT_MAX_CONCURRENCY = Math.max(1, Number(process.env.MCP_PROXY_MAX_CONCURRENCY_PER_USER ?? 4));
const DEFAULT_MAX_RPM = Math.max(1, Number(process.env.MCP_PROXY_RATE_LIMIT_PER_USER_PER_MIN ?? 120));
const REQUIRE_AUTH =
  (process.env.MCP_PROXY_REQUIRE_AUTH ??
    (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';

const HOP_BY_HOP_HEADERS = new Set([
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

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
]);

const ALLOWED_FORWARD_HEADERS = new Set([
  'accept',
  'accept-language',
  'cache-control',
  'content-type',
  'last-event-id',
  'mcp-session-id',
  'mcp-protocol-version',
  'pragma',
  'user-agent',
  'x-request-id',
  'x-mcp-upstream-authorization',
]);

const parseAllowlist = () => {
  const configured = (process.env.MCP_PROXY_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return ['mcp.linear.app', 'server.smithery.ai', 'localhost', '127.0.0.1'];
};

const isLocalDevelopmentHost = (url: URL) =>
  ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());

function isAllowlistedTarget(url: URL, allowlist: string[]): boolean {
  if (!allowlist.length) return false;
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  for (const rule of allowlist) {
    if (rule === host || rule === hostname) return true;
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      if (hostname.endsWith(suffix)) return true;
    }
  }
  return false;
}

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Last-Event-ID, MCP-Session-Id, X-MCP-Upstream-Authorization',
    Vary: 'Origin',
  };
}

function buildForwardHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (SENSITIVE_HEADERS.has(lower) && lower !== 'x-mcp-upstream-authorization') continue;
    if (!ALLOWED_FORWARD_HEADERS.has(lower)) continue;
    if (lower === 'x-mcp-upstream-authorization') {
      headers.set('Authorization', value);
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

function sanitizeUpstreamResponseHeaders(upstream: Response, corsHeaders: Record<string, string>) {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    if (lower === 'set-cookie') return;
    headers.set(key, value);
  });
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  headers.set('Cache-Control', 'no-store');
  return headers;
}

async function authorize(req: NextRequest) {
  if (!REQUIRE_AUTH) {
    const forwarded = req.headers.get('x-forwarded-for') || '';
    const ip = forwarded.split(',')[0]?.trim() || 'unknown-ip';
    const ua = req.headers.get('user-agent') || 'unknown-ua';
    const raw = new TextEncoder().encode(`${ip}|${ua}`);
    const digest = await crypto.subtle.digest('SHA-1', raw);
    const anonHash = Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return `anonymous:${anonHash}`;
  }
  const auth = await getRequestUserId(req);
  if (!auth.ok) {
    if (auth.error === 'misconfigured') {
      return NextResponse.json({ error: 'Auth configuration missing' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return auth.userId;
}

async function forward(request: NextRequest, targetUrl: URL, userId: string): Promise<Response> {
  const corsHeaders = getCorsHeaders(request);
  const maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  const maxRpm = DEFAULT_MAX_RPM;

  const rate = consumeWindowedLimit(`mcp:user:${userId}`, maxRpm, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterSec: rate.retryAfterSec },
      {
        status: 429,
        headers: { ...corsHeaders, 'Retry-After': String(rate.retryAfterSec) },
      },
    );
  }

  const slot = acquireConcurrencySlot(`mcp:user:${userId}`, maxConcurrency);
  if (!slot.ok) {
    return NextResponse.json(
      {
        error: 'Too many concurrent MCP streams',
        inFlight: slot.inFlight,
        maxConcurrency: slot.limit,
      },
      { status: 429, headers: corsHeaders },
    );
  }

  let released = false;
  const releaseSlot = () => {
    if (!released) {
      released = true;
      slot.release();
    }
  };

  try {
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'target' && !targetUrl.searchParams.has(key)) {
        targetUrl.searchParams.set(key, value);
      }
    });

    const init: RequestInit = {
      method: request.method,
      headers: buildForwardHeaders(request),
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
      cache: 'no-store',
      // @ts-expect-error duplex is required for streaming POST bodies in some runtimes.
      duplex: 'half',
    };

    const upstream = await fetch(targetUrl.toString(), init);
    const headers = sanitizeUpstreamResponseHeaders(upstream, corsHeaders);
    if (!upstream.body) {
      releaseSlot();
      return new Response(null, {
        status: upstream.status,
        headers,
      });
    }

    const reader = upstream.body.getReader();
    const proxiedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            releaseSlot();
            controller.close();
            return;
          }
          if (value) controller.enqueue(value);
        } catch (error) {
          releaseSlot();
          controller.error(error);
        }
      },
      async cancel(reason) {
        releaseSlot();
        await reader.cancel(reason);
      },
    });

    return new Response(proxiedBody, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    releaseSlot();
    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502, headers: corsHeaders },
    );
  }
}

async function handleProxy(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);
  const target = req.nextUrl.searchParams.get('target');
  if (!target) {
    return new Response('Missing "target" query parameter', { status: 400, headers: corsHeaders });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Invalid target URL', { status: 400, headers: corsHeaders });
  }

  const allowlist = parseAllowlist();
  if (!allowlist.length) {
    return NextResponse.json(
      { error: 'Server misconfigured: MCP_PROXY_ALLOWLIST is required' },
      { status: 500, headers: corsHeaders },
    );
  }

  if (targetUrl.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && isLocalDevelopmentHost(targetUrl) && targetUrl.protocol === 'http:')) {
    return new Response('Only HTTPS targets are allowed', { status: 400, headers: corsHeaders });
  }

  if (!isAllowlistedTarget(targetUrl, allowlist)) {
    return new Response('Target host is not allowlisted', { status: 403, headers: corsHeaders });
  }

  const auth = await authorize(req);
  if (auth instanceof NextResponse) {
    return auth;
  }
  return forward(req, targetUrl, auth);
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req) });
}

export async function GET(req: NextRequest) {
  return handleProxy(req);
}

export async function POST(req: NextRequest) {
  return handleProxy(req);
}

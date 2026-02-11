# Cloudflare Edge Ingress

This worker is an edge facade for high-volume stateless API paths so UI traffic can hit Cloudflare first, while keeping core application logic in Next.js.

## Routed Paths

- `/api/token`
- `/api/mcp-proxy`
- `/api/canvas-agent/ack`
- `/api/canvas-agent/screenshot`
- `/api/canvas-agent/viewport`

All other paths return `404` from the worker.

## Files

- `cloudflare/ingress/wrangler.toml`
- `cloudflare/ingress/src/index.ts`

## Configure Worker Secrets / Vars

Set these on the worker:

- `ORIGIN_BASE_URL` (required): origin app URL (for example `https://your-app.vercel.app`)
- `EDGE_ALLOWED_ORIGINS` (optional): comma-separated browser origins; defaults to request origin passthrough
- `EDGE_INGRESS_SHARED_SECRET` (optional): forwarded as `x-edge-ingress-secret` to origin

Example:

```bash
npx wrangler secret put ORIGIN_BASE_URL --config cloudflare/ingress/wrangler.toml
npx wrangler secret put EDGE_INGRESS_SHARED_SECRET --config cloudflare/ingress/wrangler.toml
```

For non-secret vars:

```bash
npx wrangler deploy --config cloudflare/ingress/wrangler.toml --var EDGE_ALLOWED_ORIGINS:\"https://app.example.com\"
```

## Local Dev

```bash
npm run cf:ingress:dev
```

## Deploy

```bash
npm run cf:ingress:deploy
```

## App Wiring

Set app env values:

- `NEXT_PUBLIC_EDGE_INGRESS_ENABLED=true`
- `NEXT_PUBLIC_EDGE_INGRESS_URL=https://present-edge-ingress.<subdomain>.workers.dev`
- `EDGE_INGRESS_ENABLED=true` (for server-side callers)
- `EDGE_INGRESS_URL=https://present-edge-ingress.<subdomain>.workers.dev`

When enabled, hot-path client/server callers use the worker URL instead of same-origin API paths.

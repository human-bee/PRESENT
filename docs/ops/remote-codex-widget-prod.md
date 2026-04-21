# Remote Codex Widget Production Runbook

The `/canvas` Remote Codex widget uses two long-lived Railway services:

- `present-codex-broker`: owns brokered Codex app-server sessions and proxying.
- `present-widget-codex`: owns the widget server registry, auth state, workspace selection, websocket snapshots, and broker session lifecycle.

Do not route this lifecycle through Vercel/serverless. The Next.js API routes only authorize the browser and proxy control-plane calls to `present-widget-codex`.

## Required Production Configuration

Set these before dispatching `.github/workflows/deploy-railway-prod.yml` from `main`.

GitHub secrets:

- `RAILWAY_API_KEY` or `RAILWAY_TOKEN`
- `CODEX_BROKER_AUTH_TOKEN`
- `CODEX_BROKER_DIRECT_TARGET_URL` or the SSH secret set required by `services/codex-broker/src/service.ts`
- `WIDGET_CODEX_DEFAULT_SERVERS`

GitHub repository variables:

- `CODEX_BROKER_PUBLIC_BASE_URL`
- `CODEX_BROKER_URL`
- `WIDGET_CODEX_PUBLIC_WS_URL`
- `WIDGET_CODEX_ALLOWED_ORIGIN=https://present.best`
- `WIDGET_CODEX_STATE_FILE=/data/widget-codex/state.json` or another durable Railway volume path

Vercel production env:

- `WIDGET_CODEX_URL` pointing at the public or private URL for `present-widget-codex`

## Smoke Test

1. Open `https://present.best/canvas`.
2. Insert the Remote Codex widget from the toolbar.
3. Confirm a saved server appears without manually entering a frame URL.
4. Authenticate if the server reports `Login Required` or `Login Expired`.
5. Select a workspace and connect.
6. Send a native widget turn and confirm it binds a reset workspace/executor.
7. Refresh the page and confirm the widget restores the same session.
8. Disconnect and confirm the broker session is torn down.

Browser payloads must not include the saved server transport config, SSH keys, broker auth token, or remote auth credentials.

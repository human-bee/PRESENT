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
- Optional: `CODEX_BROKER_DIRECT_TARGET_URL` or the SSH secret set required by `services/codex-broker/src/service.ts`
- Optional: `WIDGET_CODEX_DEFAULT_SERVERS`

GitHub repository variables:

- `CODEX_BROKER_PUBLIC_BASE_URL`
- `CODEX_BROKER_URL`
- `WIDGET_CODEX_PUBLIC_WS_URL`
- `WIDGET_CODEX_ALLOWED_ORIGIN=https://present.best`
- `WIDGET_CODEX_STATE_FILE=/data/widget-codex/state.json` or another durable Railway volume path

Vercel production env:

- `WIDGET_CODEX_URL` pointing at the public or private URL for `present-widget-codex`

The widget-owned setup path does not require a preseeded default server or global broker target. Users can create a direct or SSH-backed saved server from the canvas widget. SSH credentials are submitted to `present-widget-codex` and used server-side by `present-codex-broker`; public server/list responses and TLDraw shape state must never include private keys, host secrets, broker tokens, or remote auth credentials.

## Smoke Test

1. Open `https://present.best/canvas`.
2. Insert the Remote Codex widget from the toolbar.
3. Add a direct or SSH-backed saved server from inside the widget if no saved server exists.
4. Confirm no manual `frameUrl` entry is needed.
5. Authenticate if the server reports `Login Required` or `Login Expired`.
6. Select a workspace and connect.
7. Send a native widget turn and confirm it binds a reset workspace/executor.
8. Refresh the page and confirm the widget restores the same session.
9. Disconnect and confirm the broker session is torn down.

Browser payloads must not include the saved server transport config, SSH keys, broker auth token, or remote auth credentials.

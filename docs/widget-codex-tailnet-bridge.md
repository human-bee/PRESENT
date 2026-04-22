# Widget Codex Tailnet Bridge

The `/canvas` Remote Codex widget can connect to a Codex app server that is reachable only inside a Tailscale tailnet by adding a private Railway bridge service.

## Network Shape

```text
present-widget-codex -> present-railtail.railway.internal:2222 -> bens-macbook-pro.tailb3d6e9.ts.net:22
```

`present-railtail` joins the tailnet and forwards TCP traffic to the target Mac over Tailscale. The broker still creates an SSH tunnel from the Widget Codex service to the Mac, so the remote Codex app server can remain bound to `127.0.0.1` on the Mac.

## Railway Service

Create the service once from this repo:

```sh
railway add --service present-railtail --repo human-bee/PRESENT
```

Do not add a public Railway domain for this service. It is intended to be consumed through Railway private networking only.

## GitHub Secrets And Variables

Required secret:

```text
TAILSCALE_AUTH_KEY
```

Use a pre-authorized, ephemeral Tailscale auth key. Prefer a tagged key such as `tag:present-railtail`, then restrict that tag with Tailscale ACLs so it can reach only the Mac SSH endpoint required by Widget Codex.

Optional repository variables:

```text
RAILTAIL_TARGET_ADDR=bens-macbook-pro.tailb3d6e9.ts.net:22
RAILTAIL_LISTEN_PORT=2222
RAILTAIL_TS_HOSTNAME=present-railtail
RAILTAIL_TS_STATEDIR_PATH=/tmp/railtail
RAILTAIL_TS_EXTRA_ARGS=
```

The production Railway workflow defaults to those values when the variables are not set.

## Deploy

After the service exists and `TAILSCALE_AUTH_KEY` is set, run:

```sh
gh workflow run "Deploy Railway Prod" --ref main -f force_railtail=true
```

The workflow syncs `SERVICE_TYPE=railtail`, `TARGET_ADDR`, `LISTEN_PORT`, `TS_HOSTNAME`, `TS_AUTH_KEY`, `TS_STATEDIR_PATH`, and `TS_EXTRA_ARGS` to the `present-railtail` Railway service and redeploys it.

## Widget Server Form

Once `present-railtail` is healthy, use the Railway private host in the widget server form:

```text
SSH Host: present-railtail.railway.internal
SSH Port: 2222
SSH Username: bsteinher
Remote Codex Port: 8390
Remote Workspace: /Users/bsteinher/PRESENT
```

Keep the SSH private key and host-key fingerprint in the widget service. Do not persist them in TLDraw shape state.

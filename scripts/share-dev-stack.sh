#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
NGROK_DIR="$LOG_DIR/share"
NGROK_CONFIG="$NGROK_DIR/ngrok.yml"
NGROK_LOG="$NGROK_DIR/ngrok.log"
NGROK_PID_FILE="$NGROK_DIR/ngrok.pid"
WEB_ADDR="${NGROK_WEB_ADDR:-127.0.0.1:4040}"
NEXT_PORT="${PORT:-3000}"
SYNC_PORT="${TLDRAW_SYNC_PORT:-3100}"
LIVEKIT_HTTP_PORT="${LIVEKIT_HTTP_PORT:-7880}"
LIVEKIT_TCP_PORT="${LIVEKIT_TCP_PORT:-7882}"

ensure_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[stack:share] '$name' is required but not found in PATH." >&2
    exit 127
  fi
}

ensure_command ngrok
ensure_command curl

mkdir -p "$NGROK_DIR"

bash "$ROOT_DIR/scripts/restart-dev-stack.sh" "$@"

cat >"$NGROK_CONFIG" <<EOF2
version: "2"
web_addr: $WEB_ADDR
tunnels:
  next:
    addr: http://127.0.0.1:$NEXT_PORT
    proto: http
  sync:
    addr: http://127.0.0.1:$SYNC_PORT
    proto: http
  livekit-http:
    addr: http://127.0.0.1:$LIVEKIT_HTTP_PORT
    proto: http

EOF2

stop_existing_ngrok() {
  if [[ ! -f "$NGROK_PID_FILE" ]]; then
    return
  fi
  local pid
  pid="$(cat "$NGROK_PID_FILE")"
  if ps -p "$pid" >/dev/null 2>&1; then
    echo "[stack:share] stopping existing ngrok process ($pid)"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.5
    if ps -p "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$NGROK_PID_FILE"
}

stop_existing_ngrok

echo "[stack:share] launching ngrok tunnels (config: $NGROK_CONFIG)"
(
  cd "$ROOT_DIR" || exit 1
  nohup ngrok start --all --config "$HOME/Library/Application Support/ngrok/ngrok.yml" --config "$NGROK_CONFIG" >"$NGROK_LOG" 2>&1 &
  echo $! >"$NGROK_PID_FILE"
)

sleep 1
ngrok_pid="$(cat "$NGROK_PID_FILE")"
if ! ps -p "$ngrok_pid" >/dev/null 2>&1; then
  echo "[stack:share] ngrok exited immediately; see $NGROK_LOG for details." >&2
  exit 1
fi

host="${WEB_ADDR%%:*}"
port="${WEB_ADDR##*:}"
api_url="http://${host}:${port}/api/tunnels"

printf '[stack:share] waiting for ngrok API at %s...\n' "$api_url"

TUNNELS_JSON=""
for _ in {1..20}; do
  if TUNNELS_JSON="$(curl -fsS "$api_url" 2>/dev/null)"; then
    break
  fi
  sleep 0.5
done

if [[ -z "$TUNNELS_JSON" ]]; then
  echo "[stack:share] unable to query tunnel metadata; ngrok dashboard may require authentication."
  echo "[stack:share] logs: $NGROK_LOG"
  exit 1
fi

echo "[stack:share] tunnels ready — share these URLs:"
NEXT_PORT="$NEXT_PORT" \
SYNC_PORT="$SYNC_PORT" \
LIVEKIT_HTTP_PORT="$LIVEKIT_HTTP_PORT" \
LIVEKIT_TCP_PORT="$LIVEKIT_TCP_PORT" \
TUNNELS_JSON="$TUNNELS_JSON" \
node <<'NODE'
const data = JSON.parse(process.env.TUNNELS_JSON ?? '{}');
const friendly = new Map([
  ['next', `Next.js dev (:${process.env.NEXT_PORT})`],
  ['sync', `TLDraw sync (:${process.env.SYNC_PORT})`],
  ['livekit-http', `LiveKit HTTP (:${process.env.LIVEKIT_HTTP_PORT})`],
  ['livekit-tcp', `LiveKit TCP fallback (:${process.env.LIVEKIT_TCP_PORT})`],
]);
for (const tunnel of data.tunnels ?? []) {
  const name = tunnel.name;
  const url = tunnel.public_url;
  if (!name || !url) continue;
  const label = friendly.get(name) ?? name;
  console.log(` - ${label}: ${url}`);
}
NODE

echo "[stack:share] ngrok dashboard available at http://$WEB_ADDR"
echo "[stack:share] logs -> $NGROK_LOG"

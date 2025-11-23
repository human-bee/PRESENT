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

# Step 1: Stop any existing servers (to free up ports)
echo "[stack:share] stopping existing servers..."
bash "$ROOT_DIR/scripts/stop-dev-stack.sh" "$@"

# Step 2: Create ngrok config (3 tunnels: next, sync, livekit)
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
  livekit:
    addr: http://127.0.0.1:$LIVEKIT_HTTP_PORT
    proto: http

EOF2

# Step 3: Stop existing ngrok and start new tunnels
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
  # Start only our specific tunnels (not --all, to avoid duplicates from global config)
  # But include global config for authtoken
  nohup ngrok start next sync livekit --config "$HOME/Library/Application Support/ngrok/ngrok.yml" --config "$NGROK_CONFIG" >"$NGROK_LOG" 2>&1 &
  echo $! >"$NGROK_PID_FILE"
)

sleep 2
ngrok_pid="$(cat "$NGROK_PID_FILE")"
if ! ps -p "$ngrok_pid" >/dev/null 2>&1; then
  echo "[stack:share] ngrok exited immediately; see $NGROK_LOG for details." >&2
  exit 1
fi

# Step 4: Query ngrok API for tunnel URLs
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

# Step 5: Extract URLs and update .env.local BEFORE starting servers
SYNC_URL=$(TUNNELS_JSON="$TUNNELS_JSON" node <<'NODE'
const data = JSON.parse(process.env.TUNNELS_JSON ?? '{}');
for (const tunnel of data.tunnels ?? []) {
  if (tunnel.name === 'sync') {
    console.log(tunnel.public_url);
    break;
  }
}
NODE
)

LIVEKIT_URL=$(TUNNELS_JSON="$TUNNELS_JSON" node <<'NODE'
const data = JSON.parse(process.env.TUNNELS_JSON ?? '{}');
for (const tunnel of data.tunnels ?? []) {
  if (tunnel.name === 'livekit') {
    // Convert http URL to wss for LiveKit WebSocket
    const httpUrl = tunnel.public_url;
    const wsUrl = httpUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    console.log(wsUrl);
    break;
  }
}
NODE
)

if [[ -n "$SYNC_URL" ]] || [[ -n "$LIVEKIT_URL" ]]; then
  ENV_FILE="$ROOT_DIR/.env.local"
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔧 Configuring ngrok URLs..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Create .env.local if it doesn't exist
  if [[ ! -f "$ENV_FILE" ]]; then
    touch "$ENV_FILE"
    echo "[stack:share] created $ENV_FILE"
  fi
  
  # Update or add NEXT_PUBLIC_TLDRAW_SYNC_URL
  if [[ -n "$SYNC_URL" ]]; then
    if grep -q "^NEXT_PUBLIC_TLDRAW_SYNC_URL=" "$ENV_FILE" 2>/dev/null; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^NEXT_PUBLIC_TLDRAW_SYNC_URL=.*|NEXT_PUBLIC_TLDRAW_SYNC_URL=$SYNC_URL|" "$ENV_FILE"
      else
        sed -i "s|^NEXT_PUBLIC_TLDRAW_SYNC_URL=.*|NEXT_PUBLIC_TLDRAW_SYNC_URL=$SYNC_URL|" "$ENV_FILE"
      fi
      echo "✅ Updated NEXT_PUBLIC_TLDRAW_SYNC_URL=$SYNC_URL"
    else
      echo "NEXT_PUBLIC_TLDRAW_SYNC_URL=$SYNC_URL" >> "$ENV_FILE"
      echo "✅ Added NEXT_PUBLIC_TLDRAW_SYNC_URL=$SYNC_URL"
    fi
  fi
  
  # Update or add NEXT_PUBLIC_LIVEKIT_URL
  if [[ -n "$LIVEKIT_URL" ]]; then
    if grep -q "^NEXT_PUBLIC_LIVEKIT_URL=" "$ENV_FILE" 2>/dev/null; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^NEXT_PUBLIC_LIVEKIT_URL=.*|NEXT_PUBLIC_LIVEKIT_URL=$LIVEKIT_URL|" "$ENV_FILE"
      else
        sed -i "s|^NEXT_PUBLIC_LIVEKIT_URL=.*|NEXT_PUBLIC_LIVEKIT_URL=$LIVEKIT_URL|" "$ENV_FILE"
      fi
      echo "✅ Updated NEXT_PUBLIC_LIVEKIT_URL=$LIVEKIT_URL"
    else
      echo "NEXT_PUBLIC_LIVEKIT_URL=$LIVEKIT_URL" >> "$ENV_FILE"
      echo "✅ Added NEXT_PUBLIC_LIVEKIT_URL=$LIVEKIT_URL"
    fi
  fi
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi

# Step 6: NOW start the dev stack (which will pick up the env var)
echo "[stack:share] starting development servers with configured sync URL..."
bash "$ROOT_DIR/scripts/start-dev-stack.sh" "$@"

# Step 7: Display all tunnel URLs
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Stack is ready! Tunnels available:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
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

# Extract and highlight the iPad URL
IPAD_URL=$(TUNNELS_JSON="$TUNNELS_JSON" node <<'NODE'
const data = JSON.parse(process.env.TUNNELS_JSON ?? '{}');
for (const tunnel of data.tunnels ?? []) {
  if (tunnel.name === 'next') {
    console.log(tunnel.public_url);
    break;
  }
}
NODE
)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 Use this URL on your iPad:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   $IPAD_URL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "[stack:share] ngrok dashboard: http://$WEB_ADDR"
echo "[stack:share] ngrok logs: $NGROK_LOG"
echo "[stack:share] server logs: $LOG_DIR/*.log"

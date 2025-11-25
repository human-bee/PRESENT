#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

# Stop existing services
bash "$ROOT_DIR/scripts/stop-dev-stack.sh" "$@"

# Reset .env.local to use localhost URLs (opposite of stack:share)
if [[ -f "$ENV_FILE" ]]; then
  echo "[stack:restart] resetting .env.local to localhost mode..."
  
  # Reset TLDRAW_SYNC_URL to localhost
  if grep -q "^NEXT_PUBLIC_TLDRAW_SYNC_URL=" "$ENV_FILE" 2>/dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' 's|^NEXT_PUBLIC_TLDRAW_SYNC_URL=.*|NEXT_PUBLIC_TLDRAW_SYNC_URL=http://localhost:3100|' "$ENV_FILE"
    else
      sed -i 's|^NEXT_PUBLIC_TLDRAW_SYNC_URL=.*|NEXT_PUBLIC_TLDRAW_SYNC_URL=http://localhost:3100|' "$ENV_FILE"
    fi
    echo "  ✅ Set NEXT_PUBLIC_TLDRAW_SYNC_URL=http://localhost:3100"
  fi
  
  # Reset LIVEKIT_URL to localhost
  if grep -q "^NEXT_PUBLIC_LIVEKIT_URL=" "$ENV_FILE" 2>/dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' 's|^NEXT_PUBLIC_LIVEKIT_URL=.*|NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880|' "$ENV_FILE"
    else
      sed -i 's|^NEXT_PUBLIC_LIVEKIT_URL=.*|NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880|' "$ENV_FILE"
    fi
    echo "  ✅ Set NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880"
  fi
fi

# Start services with localhost configuration
bash "$ROOT_DIR/scripts/start-dev-stack.sh" "$@"

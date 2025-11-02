#!/usr/bin/env bash

set -euo pipefail

# Ensure common Homebrew paths are available for non-login shells
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "[LiveKit] starting dev server..."

if command -v livekit-server >/dev/null 2>&1; then
  echo "[LiveKit] using binary: $(command -v livekit-server)"
  exec livekit-server --dev
fi

echo "[LiveKit] ERROR: 'livekit-server' not found in PATH."
echo "[LiveKit] Install via Homebrew: 'brew install livekit'"
exit 127

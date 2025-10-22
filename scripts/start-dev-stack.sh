#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$LOG_DIR"

start_process() {
  local label="$1"
  local script="$2"
  local logfile="$3"

  if pgrep -f "npm run $script" >/dev/null 2>&1; then
    echo "[$label] already running."
    return
  fi

  echo "[$label] starting..."
  (
    cd "$ROOT_DIR" || exit 1
    nohup npm run "$script" >"$LOG_DIR/$logfile" 2>&1 &
    echo $! >"$LOG_DIR/$script.pid"
  )

  local pid
  pid="$(cat "$LOG_DIR/$script.pid")"
  echo "[$label] pid=$pid log=$LOG_DIR/$logfile"
}

start_process "LiveKit server" "lk:server:dev" "livekit-server.log"
start_process "Sync server" "sync:dev" "sync-dev.log"
start_process "Conductor" "agent:conductor" "agent-conductor.log"
start_process "Realtime agent" "agent:realtime" "agent-realtime.log"
start_process "Next dev" "dev" "next-dev.log"

echo "All dev services launched (or already running)."

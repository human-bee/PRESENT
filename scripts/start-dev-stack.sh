#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$LOG_DIR"

start_process() {
  local label="$1"
  local script="$2"
  local logfile="$3"
  local health_port="${4-}"

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
  sleep 1

  if ! ps -p "$pid" >/dev/null 2>&1; then
    echo "[$label] failed to stay up, see $LOG_DIR/$logfile"
    rm -f "$LOG_DIR/$script.pid"
    tail -n 20 "$LOG_DIR/$logfile" 2>/dev/null || true
    return 1
  fi

  if [[ -n "$health_port" ]]; then
    if command -v lsof >/dev/null 2>&1; then
      local ready=0
      for _ in {1..10}; do
        if lsof -nP -iTCP:"$health_port" -sTCP:LISTEN >/dev/null 2>&1; then
          ready=1
          break
        fi
        sleep 0.5
      done
      if [[ "$ready" -ne 1 ]]; then
        echo "[$label] did not expose TCP $health_port (yet); see $LOG_DIR/$logfile"
      fi
    else
      echo "[$label] skipping port check; 'lsof' unavailable."
    fi
  fi

  echo "[$label] pid=$pid log=$LOG_DIR/$logfile"
}

failures=0

start_process "LiveKit server" "lk:server:dev" "livekit-server.log" 7880 || failures=1
start_process "Sync server" "sync:dev" "sync-dev.log" || failures=1
start_process "Conductor" "agent:conductor" "agent-conductor.log" || failures=1
start_process "Realtime agent" "agent:realtime" "agent-realtime.log" || failures=1
start_process "Next dev" "dev" "next-dev.log" || failures=1

if [[ "$failures" -eq 0 ]]; then
  echo "All dev services launched (or already running)."
else
  echo "Stack launch completed with warnings; check logs above for details."
fi

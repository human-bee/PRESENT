#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

stop_process() {
  local label="$1"
  local script="$2"
  local pid_file="$LOG_DIR/$script.pid"

  if [ ! -f "$pid_file" ]; then
    echo "[$label] no pid file, nothing to stop."
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if ! ps -p "$pid" >/dev/null 2>&1; then
    echo "[$label] process $pid not running (removing stale pid file)."
    rm -f "$pid_file"
    return
  fi

  echo "[$label] stopping pid $pid..."
  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..10}; do
    if ps -p "$pid" >/dev/null 2>&1; then
      sleep 0.5
    else
      break
    fi
  done

  if ps -p "$pid" >/dev/null 2>&1; then
    echo "[$label] still running; sending SIGKILL."
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$pid_file"
  echo "[$label] stopped."
}

stop_process "Sync server" "sync:dev"
stop_process "Conductor" "agent:conductor"
stop_process "Realtime agent" "agent:realtime"
stop_process "Next dev" "dev"
stop_process "LiveKit server" "lk:server:dev"

# Ensure LiveKit ports are freed even if a stray process was running outside the stack scripts.
if command -v lsof >/dev/null 2>&1; then
  for port in 7880 7881 7882; do
    pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    for pid in $pids; do
      echo "[PortGuard] killing TCP listener $pid on :$port"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
    pids=$(lsof -tiUDP:"$port" 2>/dev/null || true)
    for pid in $pids; do
      echo "[PortGuard] killing UDP listener $pid on :$port"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  done
fi

echo "All dev services stopped (or no pid files found)."

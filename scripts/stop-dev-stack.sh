#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

usage() {
  cat <<'USAGE'
Usage: stop-dev-stack.sh [options]

Options:
  --realtime     Only stop the realtime agent
  --conductor    Only stop the conductor worker
  --sync         Only stop the TLDraw sync server
  --livekit      Only stop the LiveKit dev server
  --web          Only stop the Next.js dev server
  --all          Stop all services (default)
  --help         Show this help message

Multiple options may be combined to stop a subset of services.
When running via npm, pass flags after "--" (e.g. npm run stack:stop -- --realtime).
USAGE
}

declare -a SELECTED=()
add_target() {
  local candidate="$1"
  for existing in "${SELECTED[@]}"; do
    if [[ "$existing" == "$candidate" ]]; then
      return
    fi
  done
  SELECTED+=("$candidate")
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --realtime)
      add_target "agent:realtime"
      ;;
    --conductor)
      add_target "agent:conductor"
      ;;
    --sync)
      add_target "sync:dev"
      ;;
    --livekit)
      add_target "lk:server:dev"
      ;;
    --web)
      add_target "dev"
      ;;
    --all)
      SELECTED=()
      ;;
    --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ -n "${npm_config_realtime-}" ]]; then
  add_target "agent:realtime"
fi
if [[ -n "${npm_config_conductor-}" ]]; then
  add_target "agent:conductor"
fi
if [[ -n "${npm_config_sync-}" ]]; then
  add_target "sync:dev"
fi
if [[ -n "${npm_config_livekit-}" ]]; then
  add_target "lk:server:dev"
fi
if [[ -n "${npm_config_web-}" ]]; then
  add_target "dev"
fi
if [[ -n "${npm_config_all-}" ]]; then
  SELECTED=()
fi

should_stop() {
  local script="$1"
  if [[ ${#SELECTED[@]} -eq 0 ]]; then
    return 0
  fi
  for target in "${SELECTED[@]}"; do
    if [[ "$target" == "$script" ]]; then
      return 0
    fi
  done
  return 1
}

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

if should_stop "sync:dev"; then
  stop_process "Sync server" "sync:dev"
fi
if should_stop "agent:conductor"; then
  stop_process "Conductor" "agent:conductor"
fi
if should_stop "agent:realtime"; then
  stop_process "Realtime agent" "agent:realtime"
fi
if should_stop "dev"; then
  stop_process "Next dev" "dev"
fi
if should_stop "lk:server:dev"; then
  stop_process "LiveKit server" "lk:server:dev"
fi

# Ensure LiveKit ports are freed if we stopped the server (or the default stop-all case).
if should_stop "lk:server:dev" && command -v lsof >/dev/null 2>&1; then
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

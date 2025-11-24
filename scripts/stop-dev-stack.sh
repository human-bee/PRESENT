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
  if ((${#SELECTED[@]} > 0)); then
    for existing in "${SELECTED[@]}"; do
      if [[ "$existing" == "$candidate" ]]; then
        return
      fi
    done
  fi
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

kill_by_cwd() {
  local script_name="$1"
  local label="$2"
  
  # Find PIDs matching the npm run command
  local pids
  pids=$(pgrep -f "npm run $script_name" || echo "")
  
  for pid in $pids; do
    # Check if the process CWD matches our ROOT_DIR
    # lsof output format: command pid user fd type device size/off node name
    # We grep for 'cwd' and the ROOT_DIR
    if lsof -p "$pid" 2>/dev/null | grep "cwd" | grep -q "$ROOT_DIR"; then
      echo "[$label] killing process $pid (cwd match)"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done
}

kill_port() {
  local port="$1"
  local label="$2"
  
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  # Kill TCP listeners
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || echo "")
  pids=${pids//$'\n'/ }
  
  for pid in $pids; do
    if [[ -n "$pid" ]]; then
      echo "[$label] killing process $pid on port $port"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done
}

if should_stop "sync:dev"; then
  stop_process "Sync server" "sync:dev"
  kill_port 3100 "PortGuard:Sync"
fi
if should_stop "agent:conductor"; then
  stop_process "Conductor" "agent:conductor"
fi
if should_stop "agent:realtime"; then
  stop_process "Realtime agent" "agent:realtime"
fi
if should_stop "dev"; then
  stop_process "Next dev" "dev"
  kill_by_cwd "dev" "ProcessGuard:Web"
  kill_port 3000 "PortGuard:Web"
fi
if should_stop "lk:server:dev"; then
  stop_process "LiveKit server" "lk:server:dev"
  kill_port 7880 "PortGuard:LiveKit"
  kill_port 7881 "PortGuard:LiveKit"
  kill_port 7882 "PortGuard:LiveKit"
fi

echo "All dev services stopped (or no pid files found)."

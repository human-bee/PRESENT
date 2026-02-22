#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
STACK_MONITOR_LOCK_DIR="${TMPDIR:-/tmp}/present-dev-stack-monitor.lock"
STACK_MONITOR_LOCK_META="$STACK_MONITOR_LOCK_DIR/owner"

read_stack_lock_field() {
  local field="$1"
  if [[ ! -f "$STACK_MONITOR_LOCK_META" ]]; then
    return
  fi
  awk -F= -v field="$field" '$1 == field { print substr($0, index($0, "=") + 1); exit }' "$STACK_MONITOR_LOCK_META" 2>/dev/null
}

process_command() {
  local pid="$1"
  ps -p "$pid" -o args= 2>/dev/null || true
}

is_stack_monitor_process() {
  local pid="$1"
  local command
  command="$(process_command "$pid")"
  [[ -n "$command" ]] && [[ "$command" == *"start-dev-stack.sh"* ]]
}

process_cwd() {
  local pid="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi
  lsof -p "$pid" 2>/dev/null | awk '/ cwd /{print $NF}' | head -n 1
}

stop_stack_monitors() {
  local owner_pid owner_cwd
  owner_pid="$(read_stack_lock_field "pid")"
  owner_cwd="$(read_stack_lock_field "cwd")"
  if [[ -n "$owner_pid" ]] && is_stack_monitor_process "$owner_pid"; then
    if [[ "$owner_cwd" == "$ROOT_DIR" ]]; then
      echo "[Stack] stopping monitor pid $owner_pid (lock owner)"
      kill "$owner_pid" >/dev/null 2>&1 || true
      sleep 0.3
      if ps -p "$owner_pid" >/dev/null 2>&1; then
        kill -9 "$owner_pid" >/dev/null 2>&1 || true
      fi
    fi
  fi

  owner_pid="$(read_stack_lock_field "pid")"
  owner_cwd="$(read_stack_lock_field "cwd")"
  if [[ "$owner_cwd" == "$ROOT_DIR" ]]; then
    if [[ -z "$owner_pid" ]] || ! ps -p "$owner_pid" >/dev/null 2>&1; then
      rm -rf "$STACK_MONITOR_LOCK_DIR" >/dev/null 2>&1 || true
    fi
  fi
}

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

service_pattern() {
  local script="$1"
  case "$script" in
    "lk:server:dev")
      echo "livekit-server --dev"
      ;;
    "sync:dev")
      echo "scripts/tldraw-sync-server/server.ts"
      ;;
    "agent:conductor")
      echo "src/lib/agents/conductor/index.ts"
      ;;
    "agent:realtime")
      echo "src/lib/agents/realtime/voice-agent.ts"
      ;;
    "dev")
      echo "next dev --webpack"
      ;;
    *)
      echo ""
      ;;
  esac
}

pid_matches_root() {
  local pid="$1"
  local args
  if ! ps -p "$pid" >/dev/null 2>&1; then
    return 1
  fi
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  if [[ "$args" == *"$ROOT_DIR"* ]]; then
    return 0
  fi
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  local cwd
  cwd="$(process_cwd "$pid")"
  [[ -n "$cwd" ]] && [[ "$cwd" == "$ROOT_DIR" ]]
}

find_service_pids() {
  local script="$1"
  local pattern
  pattern="$(service_pattern "$script")"
  if [[ -z "$pattern" ]]; then
    return
  fi

  local candidates
  candidates=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [[ -z "$candidates" ]]; then
    return
  fi

  local pid
  for pid in $candidates; do
    if pid_matches_root "$pid"; then
      echo "$pid"
    fi
  done
}

terminate_pid() {
  local pid="$1"
  local label="$2"
  if ! ps -p "$pid" >/dev/null 2>&1; then
    return
  fi
  echo "[$label] stopping pid $pid..."
  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..10}; do
    if ps -p "$pid" >/dev/null 2>&1; then
      sleep 0.3
    else
      break
    fi
  done
  if ps -p "$pid" >/dev/null 2>&1; then
    echo "[$label] still running; sending SIGKILL to $pid."
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
}

stop_process() {
  local label="$1"
  local script="$2"
  local pid_file="$LOG_DIR/$script.pid"
  local stopped_any=0

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]]; then
      terminate_pid "$pid" "$label"
      stopped_any=1
    fi
    rm -f "$pid_file"
  fi

  local discovered
  discovered="$(find_service_pids "$script" | tr '\n' ' ' | xargs || true)"
  if [[ -n "$discovered" ]]; then
    local pid
    for pid in $discovered; do
      terminate_pid "$pid" "$label"
      stopped_any=1
    done
  fi

  if [[ "$stopped_any" -eq 0 ]]; then
    echo "[$label] no matching processes found."
  else
    echo "[$label] stopped."
  fi
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

if should_stop "sync:dev" || should_stop "agent:conductor" || should_stop "agent:realtime" || should_stop "dev" || should_stop "lk:server:dev"; then
  stop_stack_monitors
fi

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
  kill_port 3000 "PortGuard:Web"
fi
if should_stop "lk:server:dev"; then
  stop_process "LiveKit server" "lk:server:dev"
  kill_port 7880 "PortGuard:LiveKit"
  kill_port 7881 "PortGuard:LiveKit"
  kill_port 7882 "PortGuard:LiveKit"
fi

echo "All dev services stopped (or no pid files found)."

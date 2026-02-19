#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$LOG_DIR"

usage() {
  cat <<'USAGE'
Usage: start-dev-stack.sh [options]

Options:
  --realtime     Only start the realtime agent
  --conductor    Only start the conductor worker
  --sync         Only start the TLDraw sync server
  --livekit      Only start the LiveKit dev server
  --web          Only start the Next.js dev server
  --all          Start all services (default)
  --help         Show this help message

Multiple options may be combined to start a subset of services.
When running via npm, pass flags after "--" (e.g. npm run stack:start -- --realtime).

Note: the teacher worker remains an optional separate process. Start it with
  npm run teacher:worker
after this script if you need teacher/shadow parity metrics.
USAGE
}

declare -a SELECTED=()
add_target() {
  local candidate="$1"
  for existing in "${SELECTED[@]:-}"; do
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

should_run() {
  local script="$1"
  local selected_count=${#SELECTED[@]:-0}
  if [[ "$selected_count" -eq 0 ]]; then
    return 0
  fi
  for target in "${SELECTED[@]:-}"; do
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
  if ! ps -p "$pid" >/dev/null 2>&1; then
    return 1
  fi
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  lsof -p "$pid" 2>/dev/null | grep "cwd" | grep -q "$ROOT_DIR"
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

  local matches=()
  local pid
  for pid in $candidates; do
    if pid_matches_root "$pid"; then
      matches+=("$pid")
    fi
  done

  if [[ ${#matches[@]} -gt 0 ]]; then
    printf '%s\n' "${matches[@]}" | sort -n
  fi
}

select_primary_pid() {
  local raw="${1-}"
  if [[ -z "$raw" ]]; then
    return
  fi
  echo "$raw" | tr ' ' '\n' | awk '/^[0-9]+$/{print $0}' | sort -n | tail -n 1
}

ensure_port_free() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  # Kill TCP listeners on the port.
  local tcp_pids
  tcp_pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || echo "")
  tcp_pids=${tcp_pids//$'\n'/ }
  for pid in $tcp_pids; do
    if [[ -n "$pid" ]]; then
      echo "[PortGuard] killing TCP listener $pid on :$port"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done

  # Kill UDP listeners on the port.
  local udp_pids
  udp_pids=$(lsof -tiUDP:"$port" 2>/dev/null || echo "")
  udp_pids=${udp_pids//$'\n'/ }
  for pid in $udp_pids; do
    if [[ -n "$pid" ]]; then
      echo "[PortGuard] killing UDP listener $pid on :$port"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done
}

declare -a RUNNING_PIDS=()

cleanup_stack() {
  local pid
  for pid in "${RUNNING_PIDS[@]:-}"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  RUNNING_PIDS=()
}

trap 'cleanup_stack' EXIT

start_process() {
  local label="$1"
  local script="$2"
  local logfile="$3"
  local health_port="${4-}"

  local pidfile="$LOG_DIR/$script.pid"
  if [[ -f "$pidfile" ]]; then
    local existing_pid
    existing_pid="$(cat "$pidfile" 2>/dev/null || echo "")"
    if [[ -n "$existing_pid" ]] && pid_matches_root "$existing_pid"; then
      echo "[$label] already running (pid=$existing_pid)."
      return
    fi
    rm -f "$pidfile"
  fi

  local existing_pids
  existing_pids="$(find_service_pids "$script" | tr '\n' ' ' | xargs || true)"
  if [[ -n "$existing_pids" ]]; then
    local existing_pid
    existing_pid="$(select_primary_pid "$existing_pids")"
    echo "$existing_pid" >"$pidfile"
    echo "[$label] already running (pid=$existing_pid)."
    return
  fi

  local -a env_prefix=()
  if [[ "${FORCE_LOCAL_LIVEKIT:-0}" -eq 1 ]] && [[ "$script" != "lk:server:dev" ]]; then
    env_prefix=(
      "LIVEKIT_URL=ws://127.0.0.1:7880"
      "LIVEKIT_API_KEY=devkey"
      "LIVEKIT_API_SECRET=secret"
      "NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880"
      "CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS=3500"
      "TASK_DEFAULT_CONCURRENCY=100"
      "TASK_IDLE_POLL_MS=5"
      "TASK_IDLE_POLL_MAX_MS=20"
    )
  fi

  echo "[$label] starting..."
  (
    cd "$ROOT_DIR" || exit 1
    if [[ ${#env_prefix[@]} -gt 0 ]]; then
      nohup env "${env_prefix[@]}" npm run "$script" >"$LOG_DIR/$logfile" 2>&1 &
    else
      nohup npm run "$script" >"$LOG_DIR/$logfile" 2>&1 &
    fi
    echo $! >"$pidfile"
  )

  local discovered_pid=""
  local discovered_pids=""
  for _ in {1..20}; do
    discovered_pids="$(find_service_pids "$script" | tr '\n' ' ' | xargs || true)"
    if [[ -n "$discovered_pids" ]]; then
      discovered_pid="$(select_primary_pid "$discovered_pids")"
      echo "$discovered_pid" >"$pidfile"
      break
    fi
    sleep 0.5
  done

  if [[ -z "$discovered_pid" ]] || ! pid_matches_root "$discovered_pid"; then
    echo "[$label] failed to stay up, see $LOG_DIR/$logfile"
    rm -f "$pidfile"
    tail -n 20 "$LOG_DIR/$logfile" 2>/dev/null || true
    return 1
  fi

  RUNNING_PIDS+=("$discovered_pid")

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

  echo "[$label] pid=$discovered_pid log=$LOG_DIR/$logfile"
}

failures=0
FORCE_LOCAL_LIVEKIT=0
if should_run "lk:server:dev"; then
  FORCE_LOCAL_LIVEKIT=1
fi
if [[ "${STACK_FORCE_LOCAL_LIVEKIT:-0}" -eq 1 ]]; then
  FORCE_LOCAL_LIVEKIT=1
fi
if [[ "${STACK_DISABLE_LOCAL_LIVEKIT_ENV:-0}" -eq 1 ]]; then
  FORCE_LOCAL_LIVEKIT=0
fi

if [[ "$FORCE_LOCAL_LIVEKIT" -eq 1 ]]; then
  echo "[Stack] local LiveKit env forced for app/agents (set STACK_DISABLE_LOCAL_LIVEKIT_ENV=1 to bypass)"
fi

if should_run "lk:server:dev"; then
  ensure_port_free 7880
  ensure_port_free 7882
  start_process "LiveKit server" "lk:server:dev" "livekit-server.log" 7880 || failures=1
fi
if should_run "sync:dev"; then
  ensure_port_free 3100
  start_process "Sync server" "sync:dev" "sync-dev.log" || failures=1
fi
if should_run "agent:conductor"; then
  start_process "Conductor" "agent:conductor" "agent-conductor.log" || failures=1
fi
if should_run "agent:realtime"; then
  start_process "Realtime agent" "agent:realtime" "agent-realtime.log" || failures=1
fi
if should_run "dev"; then
  ensure_port_free 3000
  start_process "Next dev" "dev" "next-dev.log" || failures=1
fi

if [[ "$failures" -eq 0 ]]; then
  echo "All dev services launched (or already running)."
else
  echo "Stack launch completed with warnings; check logs above for details."
fi

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi

if [[ ${#RUNNING_PIDS[@]} -gt 0 ]]; then
  echo "[Stack] services running; keep this terminal open to keep the stack alive or Ctrl+C to stop."
  while true; do
    for pid in "${RUNNING_PIDS[@]}"; do
      if [[ -z "$pid" ]]; then
        continue
      fi
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        echo "[Stack] detected service pid=$pid exit; review logs for details."
        cleanup_stack
        exit 1
      fi
    done
    sleep 3
  done
fi

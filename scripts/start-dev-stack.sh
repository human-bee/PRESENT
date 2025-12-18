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

start_process() {
  local label="$1"
  local script="$2"
  local logfile="$3"
  local health_port="${4-}"

  local pidfile="$LOG_DIR/$script.pid"
  if [[ -f "$pidfile" ]]; then
    local existing_pid
    existing_pid="$(cat "$pidfile" 2>/dev/null || echo "")"
    if [[ -n "$existing_pid" ]] && ps -p "$existing_pid" >/dev/null 2>&1; then
      echo "[$label] already running (pid=$existing_pid)."
      return
    fi
    rm -f "$pidfile"
  fi

  echo "[$label] starting..."
  (
    cd "$ROOT_DIR" || exit 1
    nohup npm run "$script" >"$LOG_DIR/$logfile" 2>&1 &
    echo $! >"$pidfile"
  )

  local pid
  pid="$(cat "$pidfile")"
  sleep 1

  if ! ps -p "$pid" >/dev/null 2>&1; then
    echo "[$label] failed to stay up, see $LOG_DIR/$logfile"
    rm -f "$pidfile"
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
  start_process "Next dev" "dev" "next-dev.log" || failures=1
fi

if [[ "$failures" -eq 0 ]]; then
  echo "All dev services launched (or already running)."
else
  echo "Stack launch completed with warnings; check logs above for details."
fi

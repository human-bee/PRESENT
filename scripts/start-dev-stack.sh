#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
STACK_MONITOR_LOCK_DIR="${TMPDIR:-/tmp}/present-dev-stack-monitor.lock"
STACK_MONITOR_LOCK_META="$STACK_MONITOR_LOCK_DIR/owner"

mkdir -p "$LOG_DIR"

write_stack_lock_meta() {
  cat >"$STACK_MONITOR_LOCK_META" <<EOF
pid=$$
cwd=$ROOT_DIR
started_at=$(date +%s)
EOF
}

read_stack_lock_field() {
  local field="$1"
  if [[ ! -f "$STACK_MONITOR_LOCK_META" ]]; then
    return
  fi
  awk -F= -v field="$field" '$1 == field { print substr($0, index($0, "=") + 1); exit }' "$STACK_MONITOR_LOCK_META" 2>/dev/null
}

acquire_stack_monitor_lock() {
  local auto_stop="${STACK_AUTO_STOP_FOREIGN_MONITORS:-1}"
  local attempts=0

  while [[ "$attempts" -lt 6 ]]; do
    if mkdir "$STACK_MONITOR_LOCK_DIR" 2>/dev/null; then
      write_stack_lock_meta
      return 0
    fi

    local owner_pid owner_cwd
    owner_pid="$(read_stack_lock_field "pid")"
    owner_cwd="$(read_stack_lock_field "cwd")"

    if [[ -n "$owner_pid" ]] && ps -p "$owner_pid" >/dev/null 2>&1; then
      if [[ "$owner_cwd" == "$ROOT_DIR" ]]; then
        echo "[Stack] monitor already running for this workspace (pid=$owner_pid)."
        return 2
      fi
      if [[ "$auto_stop" == "1" ]]; then
        echo "[Stack] stopping lock owner pid=$owner_pid cwd=${owner_cwd:-unknown}"
        kill "$owner_pid" 2>/dev/null || true
        sleep 0.5
        if ps -p "$owner_pid" >/dev/null 2>&1; then
          kill -9 "$owner_pid" 2>/dev/null || true
        fi
      else
        echo "[Stack] monitor lock held by pid=$owner_pid cwd=${owner_cwd:-unknown}"
        echo "[Stack] Set STACK_AUTO_STOP_FOREIGN_MONITORS=1 to auto-stop lock holder."
        return 1
      fi
    else
      rm -rf "$STACK_MONITOR_LOCK_DIR" 2>/dev/null || true
    fi

    attempts=$((attempts + 1))
    sleep 0.5
  done

  echo "[Stack] unable to acquire monitor lock at $STACK_MONITOR_LOCK_DIR"
  return 1
}

release_stack_monitor_lock() {
  if [[ ! -d "$STACK_MONITOR_LOCK_DIR" ]]; then
    return
  fi
  local owner_pid owner_cwd
  owner_pid="$(read_stack_lock_field "pid")"
  owner_cwd="$(read_stack_lock_field "cwd")"
  local should_release=0
  if [[ "$owner_pid" == "$$" ]]; then
    should_release=1
  elif [[ "$owner_cwd" == "$ROOT_DIR" ]]; then
    if [[ -z "$owner_pid" ]] || ! ps -p "$owner_pid" >/dev/null 2>&1; then
      should_release=1
    fi
  fi
  if [[ "$should_release" -eq 1 ]]; then
    rm -rf "$STACK_MONITOR_LOCK_DIR" 2>/dev/null || true
  fi
}

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

pid_is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

process_cwd() {
  local pid="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi
  lsof -p "$pid" 2>/dev/null | awk '/ cwd /{print $NF}' | head -n 1
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

find_foreign_service_pids() {
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
    if ! pid_is_running "$pid"; then
      continue
    fi
    if pid_matches_root "$pid"; then
      continue
    fi
    matches+=("$pid")
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
  # Prefer the oldest matching pid to avoid pinning transient child workers.
  echo "$raw" | tr ' ' '\n' | awk '/^[0-9]+$/{print $0}' | sort -n | head -n 1
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

ensure_service_ports_free() {
  local script="$1"
  case "$script" in
    "lk:server:dev")
      ensure_port_free 7880
      ensure_port_free 7881
      ensure_port_free 7882
      ;;
    "sync:dev")
      ensure_port_free 3100
      ;;
    "dev")
      ensure_port_free 3000
      ;;
  esac
}

stop_foreign_service_instances() {
  local script="$1"
  local label="$2"
  local auto_stop="${STACK_AUTO_STOP_FOREIGN_SERVICES:-1}"
  local foreign_pids
  foreign_pids="$(find_foreign_service_pids "$script" | tr '\n' ' ' | xargs || true)"
  if [[ -z "$foreign_pids" ]]; then
    return 0
  fi

  if [[ "$auto_stop" != "1" ]]; then
    echo "[Stack] conflicting $label process(es) outside this workspace: $foreign_pids"
    echo "[Stack] Set STACK_AUTO_STOP_FOREIGN_SERVICES=1 to auto-stop foreign service processes."
    return 1
  fi

  local pid
  for pid in $foreign_pids; do
    if ! pid_is_running "$pid"; then
      continue
    fi
    local cwd
    cwd="$(process_cwd "$pid")"
    echo "[Stack] stopping conflicting $label pid=$pid cwd=${cwd:-unknown}"
    kill "$pid" 2>/dev/null || true
  done

  sleep 0.6
  for pid in $foreign_pids; do
    if pid_is_running "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  return 0
}

declare -a RUNNING_PIDS=()
declare -a STARTED_SERVICES=()

ensure_no_foreign_stack_monitors() {
  local auto_stop="${STACK_AUTO_STOP_FOREIGN_MONITORS:-1}"
  local self_pid="$$"
  local foreign_found=0
  local pid
  for pid in $(pgrep -f "bash scripts/start-dev-stack.sh" 2>/dev/null || true); do
    if [[ -z "$pid" ]] || [[ "$pid" == "$self_pid" ]]; then
      continue
    fi
    if ! pid_is_running "$pid"; then
      continue
    fi
    local cwd
    cwd="$(process_cwd "$pid")"
    if [[ -z "$cwd" ]] || [[ "$cwd" == "$ROOT_DIR" ]]; then
      continue
    fi
    foreign_found=1
    if [[ "$auto_stop" == "1" ]]; then
      echo "[Stack] stopping conflicting stack monitor pid=$pid cwd=$cwd"
      kill "$pid" 2>/dev/null || true
    else
      echo "[Stack] conflicting stack monitor detected pid=$pid cwd=$cwd"
    fi
  done
  if [[ "$foreign_found" -eq 1 ]] && [[ "$auto_stop" != "1" ]]; then
    echo "[Stack] Refusing to continue with foreign monitors present."
    echo "[Stack] Set STACK_AUTO_STOP_FOREIGN_MONITORS=1 to auto-stop conflicts."
    return 1
  fi
}

add_started_service() {
  local candidate="$1"
  for existing in "${STARTED_SERVICES[@]:-}"; do
    if [[ "$existing" == "$candidate" ]]; then
      return
    fi
  done
  STARTED_SERVICES+=("$candidate")
}

service_label() {
  local script="$1"
  case "$script" in
    "lk:server:dev")
      echo "LiveKit server"
      ;;
    "sync:dev")
      echo "Sync server"
      ;;
    "agent:conductor")
      echo "Conductor"
      ;;
    "agent:realtime")
      echo "Realtime agent"
      ;;
    "dev")
      echo "Next dev"
      ;;
    *)
      echo "$script"
      ;;
  esac
}

service_logfile() {
  local script="$1"
  case "$script" in
    "lk:server:dev")
      echo "livekit-server.log"
      ;;
    "sync:dev")
      echo "sync-dev.log"
      ;;
    "agent:conductor")
      echo "agent-conductor.log"
      ;;
    "agent:realtime")
      echo "agent-realtime.log"
      ;;
    "dev")
      echo "next-dev.log"
      ;;
    *)
      echo "stack-${script//[:\/]/-}.log"
      ;;
  esac
}

service_health_port() {
  local script="$1"
  case "$script" in
    "lk:server:dev")
      echo "7880"
      ;;
    "sync:dev")
      echo "3100"
      ;;
    "dev")
      echo "3000"
      ;;
    *)
      echo ""
      ;;
  esac
}

cleanup_stack() {
  local pid
  for pid in "${RUNNING_PIDS[@]:-}"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  RUNNING_PIDS=()
}

trap 'cleanup_stack; release_stack_monitor_lock' EXIT

start_process() {
  local label="$1"
  local script="$2"
  local logfile="$3"
  local health_port="${4-}"

  local pidfile="$LOG_DIR/$script.pid"
  if ! stop_foreign_service_instances "$script" "$label"; then
    return 1
  fi
  if [[ -f "$pidfile" ]]; then
    local existing_pid
    existing_pid="$(cat "$pidfile" 2>/dev/null || echo "")"
    if pid_is_running "$existing_pid"; then
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
lock_result=0

acquire_stack_monitor_lock || lock_result=$?
if [[ "$lock_result" -eq 2 ]]; then
  exit 0
fi
if [[ "$lock_result" -ne 0 ]]; then
  exit 1
fi

ensure_no_foreign_stack_monitors || failures=1
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
  add_started_service "lk:server:dev"
  stop_foreign_service_instances "lk:server:dev" "LiveKit server" || failures=1
  ensure_service_ports_free "lk:server:dev"
  start_process "LiveKit server" "lk:server:dev" "livekit-server.log" 7880 || failures=1
fi
if should_run "sync:dev"; then
  add_started_service "sync:dev"
  stop_foreign_service_instances "sync:dev" "Sync server" || failures=1
  ensure_service_ports_free "sync:dev"
  start_process "Sync server" "sync:dev" "sync-dev.log" || failures=1
fi
if should_run "agent:conductor"; then
  add_started_service "agent:conductor"
  stop_foreign_service_instances "agent:conductor" "Conductor" || failures=1
  start_process "Conductor" "agent:conductor" "agent-conductor.log" || failures=1
fi
if should_run "agent:realtime"; then
  add_started_service "agent:realtime"
  stop_foreign_service_instances "agent:realtime" "Realtime agent" || failures=1
  start_process "Realtime agent" "agent:realtime" "agent-realtime.log" || failures=1
fi
if should_run "dev"; then
  add_started_service "dev"
  stop_foreign_service_instances "dev" "Next dev" || failures=1
  ensure_service_ports_free "dev"
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

if [[ ${#STARTED_SERVICES[@]} -gt 0 ]]; then
  echo "[Stack] services running; keep this terminal open to keep the stack alive or Ctrl+C to stop."
  while true; do
    ensure_no_foreign_stack_monitors || true
    for script in "${STARTED_SERVICES[@]}"; do
      stop_foreign_service_instances "$script" "$(service_label "$script")" || true
      local_pidfile="$LOG_DIR/$script.pid"
      local_pid="$(cat "$local_pidfile" 2>/dev/null || echo "")"
      if pid_is_running "$local_pid"; then
        continue
      fi
      rediscovered="$(find_service_pids "$script" | tr '\n' ' ' | xargs || true)"
      if [[ -n "$rediscovered" ]]; then
        rediscovered_pid="$(select_primary_pid "$rediscovered")"
        if pid_is_running "$rediscovered_pid"; then
          echo "$rediscovered_pid" >"$local_pidfile"
          continue
        fi
      fi
      echo "[Stack] detected $script stopped; attempting restart..."
      health_port="$(service_health_port "$script")"
      ensure_service_ports_free "$script"
      if ! start_process "$(service_label "$script")" "$script" "$(service_logfile "$script")" "$health_port"; then
        echo "[Stack] restart failed for $script; keeping other services alive."
      fi
    done
    sleep 3
  done
fi

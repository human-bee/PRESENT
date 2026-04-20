#!/bin/sh
set -eu

# Default to web for generic deployments that don't inject SERVICE_TYPE.
SERVICE_TYPE="${SERVICE_TYPE:-web}"

case "$SERVICE_TYPE" in
  sync)
    echo "Starting Sync Server..."
    exec npm run sync:dev
    ;;
  agent|conductor)
    echo "Starting Conductor Agent..."
    exec npm run agent:conductor
    ;;
  realtime)
    echo "Starting Realtime Agent..."
    exec npm run agent:realtime
    ;;
  codex-broker|broker)
    echo "Starting Codex Broker..."
    exec npm run codex:broker
    ;;
  widget-codex|codex-widget)
    echo "Starting Widget Codex Service..."
    exec npm run widget:codex
    ;;
  web|present|app)
    echo "Starting Web App..."
    if [ ! -d ".next" ]; then
      echo "No .next build output found. Running build..."
      npm run build
    fi
    exec npm run start
    ;;
  *)
    echo "Error: unsupported SERVICE_TYPE value: ${SERVICE_TYPE:-<unset>}" >&2
    echo "Expected one of: sync, agent, conductor, realtime, codex-broker, broker, widget-codex, codex-widget, web, present, app" >&2
    exit 1
    ;;
esac

#!/bin/sh

if [ "$SERVICE_TYPE" = "sync" ]; then
  echo "Starting Sync Server..."
  npm run sync:dev
elif [ "$SERVICE_TYPE" = "agent" ]; then
  echo "Starting Agent..."
  npm run agent:conductor
else
  echo "Error: SERVICE_TYPE env var not set or invalid (value: $SERVICE_TYPE). defaulting to sync"
  npm run sync:dev
fi

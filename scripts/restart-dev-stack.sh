#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

bash "$ROOT_DIR/scripts/stop-dev-stack.sh" "$@"
bash "$ROOT_DIR/scripts/start-dev-stack.sh" "$@"

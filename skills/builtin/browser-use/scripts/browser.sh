#!/bin/bash
# Headless browser-use CLI.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
export BROWSER_USE_SERVER="${BROWSER_USE_SERVER:-http://127.0.0.1:8933}"
export BROWSER_USE_CONNECTION_FILE="${BROWSER_USE_CONNECTION_FILE:-$PROJECT_DIR/.connection}"

NODE_CMD=""
NODE_ARGS=()
NODE_ENV_PREFIX=()
MIN_NODE_MAJOR=18

node_runtime_major() {
  local CMD="$1"
  shift

  env "$@" "$CMD" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null
}

is_supported_node_runtime() {
  local CMD="$1"
  shift
  local MAJOR
  MAJOR="$(node_runtime_major "$CMD" "$@" || true)"

  if [ -z "$MAJOR" ]; then
    return 1
  fi

  [ "$MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null
}

resolve_node_runtime() {
  if command -v node > /dev/null 2>&1 && is_supported_node_runtime "node"; then
    NODE_CMD="node"
    NODE_ARGS=()
    NODE_ENV_PREFIX=()
    return 0
  fi

  if [ -n "${BIZOWL_ELECTRON_PATH:-}" ] \
    && [ -x "${BIZOWL_ELECTRON_PATH}" ] \
    && is_supported_node_runtime "${BIZOWL_ELECTRON_PATH}" "ELECTRON_RUN_AS_NODE=1"; then
    NODE_CMD="$BIZOWL_ELECTRON_PATH"
    NODE_ARGS=()
    NODE_ENV_PREFIX=("ELECTRON_RUN_AS_NODE=1")
    return 0
  fi

  return 1
}

if ! resolve_node_runtime; then
  echo "Failed to run browser-use: compatible Node.js runtime not found (requires Node.js $MIN_NODE_MAJOR+)." >&2
  exit 1
fi

if [ "${1:-}" = "help" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" "$SCRIPT_DIR/browser-use.js" help
  exit $?
fi

if ! bash "$SCRIPT_DIR/start-server.sh" > /dev/null; then
  echo "Failed to start browser-use bridge. Recent logs:" >&2
  if [ -f "$PROJECT_DIR/.server.log" ]; then
    tail -20 "$PROJECT_DIR/.server.log" >&2
  fi
  exit 1
fi

env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" "$SCRIPT_DIR/browser-use.js" "$@"

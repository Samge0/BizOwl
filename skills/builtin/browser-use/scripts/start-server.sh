#!/bin/bash
# Start headless browser-use bridge server.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.server.pid"
LOG_FILE="$PROJECT_DIR/.server.log"
SERVER_URL="${BROWSER_USE_SERVER:-http://127.0.0.1:8933}"
CDP_PORT="${BROWSER_USE_CDP_PORT:-9223}"

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

resolve_web_search_dir() {
  if [ -n "${BROWSER_USE_WEB_SEARCH_DIR:-}" ] && [ -d "$BROWSER_USE_WEB_SEARCH_DIR" ]; then
    printf '%s' "$BROWSER_USE_WEB_SEARCH_DIR"
    return 0
  fi

  if [ -n "${SKILLS_ROOT:-}" ] && [ -d "$SKILLS_ROOT/web-search" ]; then
    printf '%s' "$SKILLS_ROOT/web-search"
    return 0
  fi

  local REPO_SKILLS_ROOT
  REPO_SKILLS_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
  if [ -d "$REPO_SKILLS_ROOT/web-search" ]; then
    printf '%s' "$REPO_SKILLS_ROOT/web-search"
    return 0
  fi

  return 1
}

http_get() {
  local URL="$1"

  if command -v curl > /dev/null 2>&1; then
    if curl -s -f "$URL" 2>/dev/null; then
      return 0
    fi
  fi

  if command -v wget > /dev/null 2>&1; then
    if wget -q -O- "$URL" 2>/dev/null; then
      return 0
    fi
  fi

  if ! resolve_node_runtime; then
    return 127
  fi

  env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" - "$URL" <<'NODE'
const [url] = process.argv.slice(2);

(async () => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      process.exit(22);
    }
    process.stdout.write(await response.text());
  } catch {
    process.exit(1);
  }
})();
NODE
}

is_server_healthy() {
  local HEALTH_RESPONSE
  HEALTH_RESPONSE="$(http_get "${SERVER_URL%/}/api/health" || true)"
  echo "$HEALTH_RESPONSE" | grep -q '"success":true'
}

if is_server_healthy; then
  echo "✓ Browser-use bridge is already running (${SERVER_URL%/}/api/health)"
  exit 0
fi

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if ps -p "$PID" > /dev/null 2>&1; then
    kill "$PID" > /dev/null 2>&1 || true
    sleep 1
    if ps -p "$PID" > /dev/null 2>&1; then
      kill -9 "$PID" > /dev/null 2>&1 || true
    fi
  fi
  rm -f "$PID_FILE"
fi

if ! resolve_node_runtime; then
  echo "✗ Failed to start browser-use bridge"
  echo "  Compatible Node.js runtime not found (requires Node.js $MIN_NODE_MAJOR+)."
  exit 1
fi

if ! WEB_SEARCH_DIR="$(resolve_web_search_dir)"; then
  echo "✗ Failed to start browser-use bridge"
  echo "  Could not locate the web-search skill runtime."
  exit 1
fi

SERVER_ENTRY="$WEB_SEARCH_DIR/dist/server/index.js"
if [ ! -f "$SERVER_ENTRY" ]; then
  echo "Compiling web-search bridge runtime..."
  if ! npm run build --prefix "$WEB_SEARCH_DIR" > /dev/null 2>&1; then
    echo "✗ Failed to compile web-search bridge runtime"
    exit 1
  fi
fi

echo "Starting browser-use bridge..."
nohup env \
  WEB_SEARCH_SERVER="$SERVER_URL" \
  WEB_SEARCH_BROWSER_HEADLESS=1 \
  WEB_SEARCH_CDP_PORT="$CDP_PORT" \
  WEB_SEARCH_BROWSER_BACKEND="${WEB_SEARCH_BROWSER_BACKEND:-auto}" \
  BIZOWL_ELECTRON_BROWSER_URL="${BIZOWL_ELECTRON_BROWSER_URL:-}" \
  BIZOWL_BRIDGE_SECRET="${BIZOWL_BRIDGE_SECRET:-}" \
  "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" "$SERVER_ENTRY" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 2

if is_server_healthy; then
  echo "✓ Browser-use bridge started successfully (PID: $SERVER_PID)"
  echo "  Health check: ${SERVER_URL%/}/api/health"
  echo "  Logs: $LOG_FILE"
  exit 0
fi

echo "✗ Failed to start browser-use bridge"
echo "  Check logs: $LOG_FILE"
rm -f "$PID_FILE"
exit 1

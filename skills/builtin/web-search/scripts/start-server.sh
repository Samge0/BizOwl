#!/bin/bash
# Start Web Search Bridge Server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.server.pid"
LOG_FILE="$PROJECT_DIR/.server.log"
LOCK_DIR="$PROJECT_DIR/.server.lock"
SERVER_ENTRY="dist/server/index.js"
FORCE_REPAIR="${WEB_SEARCH_FORCE_REPAIR:-0}"
SERVER_PORT="37823"
DEFAULT_SERVER_URL="http://127.0.0.1:37823"
SERVER_URL="${WEB_SEARCH_SERVER:-$DEFAULT_SERVER_URL}"
HEALTHY_SERVER_URL=""
BRIDGE_SERVICE_NAME="web-search-bridge"
BRIDGE_API_VERSION="2"
LOCK_WAIT_TIMEOUT="${WEB_SEARCH_LOCK_WAIT_TIMEOUT:-30}"
LOCK_STALE_SECONDS="${WEB_SEARCH_LOCK_STALE_SECONDS:-60}"
LOCK_ACQUIRED=0

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

ensure_npm_available() {
  if command -v npm > /dev/null 2>&1; then
    return 0
  fi

  echo "✗ npm is unavailable, cannot repair web-search runtime"
  echo "  Please reinstall the web-search skill runtime from BizOwl."
  return 1
}

install_dependencies() {
  echo "Installing dependencies..."
  if ! npm install > /dev/null 2>&1; then
    echo "✗ Failed to install dependencies"
    echo "  Check network access and npm logs, then retry."
    return 1
  fi
  return 0
}

repair_iconv_lite() {
  echo "Repairing incomplete iconv-lite installation..."
  rm -rf "node_modules/iconv-lite"
  if ! npm install --no-save iconv-lite > /dev/null 2>&1; then
    echo "✗ Failed to repair iconv-lite dependency"
    return 1
  fi
  return 0
}

verify_iconv_runtime() {
  env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" -e "require('./node_modules/iconv-lite/lib/index.js')" > /dev/null 2>&1
}

is_server_build_outdated() {
  if [ ! -f "$SERVER_ENTRY" ]; then
    return 0
  fi

  if [ -n "$(find server -type f -name '*.ts' -newer "$SERVER_ENTRY" -print -quit 2>/dev/null)" ]; then
    return 0
  fi

  # Legacy dist builds used a score-based encoding heuristic that can corrupt CJK.
  if grep -q "function scoreDecodedJsonText" "$SERVER_ENTRY" 2>/dev/null; then
    return 0
  fi

  return 1
}

kill_listeners_on_server_port() {
  if ! command -v lsof > /dev/null 2>&1; then
    return 0
  fi

  local PIDS
  PIDS=$(lsof -ti "tcp:$SERVER_PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')
  if [ -z "$PIDS" ]; then
    return 0
  fi

  echo "Force-repair enabled, stopping listeners on port $SERVER_PORT: $PIDS"
  for PID in $PIDS; do
    kill "$PID" > /dev/null 2>&1 || true
  done

  sleep 1

  for PID in $PIDS; do
    if ps -p "$PID" > /dev/null 2>&1; then
      kill -9 "$PID" > /dev/null 2>&1 || true
    fi
  done
}

is_bridge_server_healthy_at() {
  local BASE_URL="${1%/}"
  local HEALTH_URL="$BASE_URL/api/health"
  local HEALTH_RESPONSE
  HEALTH_RESPONSE=$(http_get "$HEALTH_URL" || true)

  if echo "$HEALTH_RESPONSE" | grep -q '"success":true' \
    && echo "$HEALTH_RESPONSE" | grep -q "\"service\":\"$BRIDGE_SERVICE_NAME\"" \
    && echo "$HEALTH_RESPONSE" | grep -q "\"apiVersion\":$BRIDGE_API_VERSION"; then
    return 0
  fi

  return 1
}

detect_healthy_bridge_server() {
  local CANDIDATES=("$SERVER_URL")

  if [ "$SERVER_URL" != "$DEFAULT_SERVER_URL" ]; then
    CANDIDATES+=("$DEFAULT_SERVER_URL")
  fi

  for CANDIDATE in "${CANDIDATES[@]}"; do
    if is_bridge_server_healthy_at "$CANDIDATE"; then
      HEALTHY_SERVER_URL="$CANDIDATE"
      return 0
    fi
  done

  return 1
}

release_start_lock() {
  if [ "$LOCK_ACQUIRED" = "1" ]; then
    rmdir "$LOCK_DIR" > /dev/null 2>&1 || true
    LOCK_ACQUIRED=0
  fi
}

lock_age_seconds() {
  if [ ! -d "$LOCK_DIR" ]; then
    echo 0
    return 0
  fi

  local NOW
  NOW=$(date +%s)
  local MTIME
  if stat -f %m "$LOCK_DIR" > /dev/null 2>&1; then
    MTIME=$(stat -f %m "$LOCK_DIR")
  else
    MTIME=$(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo "$NOW")
  fi
  echo $((NOW - MTIME))
}

wait_for_healthy_server_during_lock() {
  local WAITED=0
  while [ "$WAITED" -lt "$LOCK_WAIT_TIMEOUT" ]; do
    if detect_healthy_bridge_server; then
      echo "✓ Bridge Server is already running (detected via health endpoint: ${HEALTHY_SERVER_URL%/}/api/health)"
      return 0
    fi
    sleep 1
    WAITED=$((WAITED + 1))
  done
  return 1
}

acquire_start_lock() {
  while ! mkdir "$LOCK_DIR" > /dev/null 2>&1; do
    if wait_for_healthy_server_during_lock; then
      exit 0
    fi

    if [ "$(lock_age_seconds)" -ge "$LOCK_STALE_SECONDS" ]; then
      rmdir "$LOCK_DIR" > /dev/null 2>&1 || true
      continue
    fi

    echo "✗ Another Bridge Server startup is in progress and did not become healthy"
    exit 1
  done

  LOCK_ACQUIRED=1
  trap release_start_lock EXIT INT TERM
}

acquire_start_lock

# If no force repair is requested and another healthy bridge is already running
# on the target port, treat it as running even when PID file is missing.
if [ "$FORCE_REPAIR" != "1" ] && detect_healthy_bridge_server; then
  echo "✓ Bridge Server is already running (detected via health endpoint: ${HEALTHY_SERVER_URL%/}/api/health)"
  exit 0
fi

# Check if server is already running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    if [ "$FORCE_REPAIR" = "1" ]; then
      echo "Force-repair enabled, stopping existing Bridge Server (PID: $PID)..."
      kill "$PID" > /dev/null 2>&1 || true
      sleep 1
      if ps -p "$PID" > /dev/null 2>&1; then
        kill -9 "$PID" > /dev/null 2>&1 || true
      fi
      rm -f "$PID_FILE"
    else
      if is_bridge_server_healthy_at "$SERVER_URL" || detect_healthy_bridge_server; then
        echo "✓ Bridge Server is already running (PID: $PID)"
        exit 0
      fi
      echo "Existing Bridge Server PID is alive but health check failed; stopping it..."
      kill "$PID" > /dev/null 2>&1 || true
      sleep 1
      if ps -p "$PID" > /dev/null 2>&1; then
        kill -9 "$PID" > /dev/null 2>&1 || true
      fi
      rm -f "$PID_FILE"
    fi
  else
    # Stale PID file, remove it
    rm "$PID_FILE"
  fi
fi

if [ "$FORCE_REPAIR" = "1" ]; then
  kill_listeners_on_server_port
fi

# Start the server in background
echo "Starting Bridge Server..."
cd "$PROJECT_DIR"

if ! resolve_node_runtime; then
  echo "✗ Failed to start Bridge Server"
  echo "  Compatible Node.js runtime not found (requires Node.js $MIN_NODE_MAJOR+)."
  echo "  Please install a newer Node.js, or run from BizOwl so scripts can use Electron runtime."
  exit 1
fi

# Verify a critical transitive dependency before deciding whether to reinstall.
# Some historical installs had partial node_modules trees (missing iconv-lite encodings).
ICONV_SENTINEL="node_modules/iconv-lite/encodings/index.js"

if [ "$FORCE_REPAIR" = "1" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! repair_iconv_lite; then
    exit 1
  fi
fi

# Ensure dependencies are installed
if [ ! -d "node_modules" ] || [ ! -f "$ICONV_SENTINEL" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! install_dependencies; then
    exit 1
  fi
fi

# npm install may succeed while keeping a corrupted cached package.
if [ ! -f "$ICONV_SENTINEL" ]; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! repair_iconv_lite; then
    exit 1
  fi
fi

if [ ! -f "$ICONV_SENTINEL" ]; then
  echo "✗ Dependency check failed: missing $ICONV_SENTINEL"
  echo "  Try removing node_modules and reinstalling with network access."
  exit 1
fi

if ! verify_iconv_runtime; then
  if ! ensure_npm_available; then
    exit 1
  fi
  if ! repair_iconv_lite; then
    exit 1
  fi
fi

if ! verify_iconv_runtime; then
  echo "✗ iconv-lite runtime verification failed after repair"
  echo "  Try removing node_modules and reinstalling with network access."
  exit 1
fi

# Ensure code is compiled and not stale
if is_server_build_outdated; then
  if ! ensure_npm_available; then
    exit 1
  fi
  echo "Compiling TypeScript (dist missing/outdated)..."
  if ! npm run build > /dev/null 2>&1; then
    echo "✗ Failed to compile TypeScript server"
    exit 1
  fi
fi

# Start server in background
nohup env "${NODE_ENV_PREFIX[@]}" "$NODE_CMD" "${NODE_ARGS[@]}" "$SERVER_ENTRY" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Save PID
echo "$SERVER_PID" > "$PID_FILE"

# Wait a moment to check if server started successfully
sleep 2

if ps -p "$SERVER_PID" > /dev/null 2>&1; then
  echo "✓ Bridge Server started successfully (PID: $SERVER_PID)"
  echo "  Health check: ${DEFAULT_SERVER_URL}/api/health"
  if [ "$SERVER_URL" != "$DEFAULT_SERVER_URL" ]; then
    echo "  Requested endpoint: ${SERVER_URL%/}/api/health"
  fi
  echo "  Logs: $LOG_FILE"
else
  if detect_healthy_bridge_server; then
    echo "✓ Bridge Server is already running (detected via health endpoint: ${HEALTHY_SERVER_URL%/}/api/health)"
    rm -f "$PID_FILE"
    exit 0
  fi

  echo "✗ Failed to start Bridge Server"
  echo "  Check logs: $LOG_FILE"
  rm "$PID_FILE"
  exit 1
fi

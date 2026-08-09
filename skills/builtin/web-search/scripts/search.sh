#!/bin/bash
# Web Search CLI - Simplified search interface for Claude

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEFAULT_SERVER_URL="http://127.0.0.1:37823"
SERVER_URL="${WEB_SEARCH_SERVER:-$DEFAULT_SERVER_URL}"
ACTIVE_SERVER_URL="$SERVER_URL"
CONNECTION_CACHE="$PROJECT_DIR/.connection"
BRIDGE_SERVICE_NAME="web-search-bridge"
BRIDGE_API_VERSION="2"
REPAIR_WAIT_TIMEOUT="${WEB_SEARCH_REPAIR_WAIT_TIMEOUT:-30}"
REPAIR_WAIT_INTERVAL="${WEB_SEARCH_REPAIR_WAIT_INTERVAL:-1}"
ELECTRON_FALLBACK_ENABLED="${WEB_SEARCH_ELECTRON_FALLBACK:-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

HTTP_NODE_CMD=""
HTTP_NODE_ARGS=()
HTTP_NODE_ENV_PREFIX=()
MIN_NODE_MAJOR=18

is_windows_bash() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Usage information
usage() {
  cat << EOF
Usage: $(basename "$0") <query|@query_file> [max_results]
       $(basename "$0") --json <query|@query_file> [max_results]

Arguments:
  query         Search query (required), or @UTF-8-file-path for non-ASCII
  max_results   Maximum number of results (default: 10)

Examples:
  $(basename "$0") "TypeScript tutorial" 5
  $(basename "$0") "React hooks" 10

Environment:
  WEB_SEARCH_SERVER   Bridge Server URL (default: http://127.0.0.1:37823)
  WEB_SEARCH_ENGINE   Preferred engine: auto|google|bing|baidu|360|sogou (default: auto)
  WEB_SEARCH_FALLBACK_ORDER
                      Auto-mode fallback order, comma-separated (default: baidu,bing,360,sogou,google)
  WEB_SEARCH_CLEANUP  Set to 1 to close browser after each search (default: keep alive)
  WEB_SEARCH_REPAIR_WAIT_TIMEOUT
                      Seconds to wait for server repair before Electron fallback (default: 30)
  WEB_SEARCH_ELECTRON_FALLBACK
                      Set to 0 to disable Electron browser bridge fallback

EOF
  exit 1
}

resolve_http_node_runtime() {
  if [ -n "$HTTP_NODE_CMD" ]; then
    return 0
  fi

  if command -v node > /dev/null 2>&1 && is_supported_node_runtime "node"; then
    HTTP_NODE_CMD="node"
    HTTP_NODE_ARGS=()
    HTTP_NODE_ENV_PREFIX=()
    return 0
  fi

  if [ -n "${BIZOWL_ELECTRON_PATH:-}" ] \
    && [ -x "${BIZOWL_ELECTRON_PATH}" ] \
    && is_supported_node_runtime "${BIZOWL_ELECTRON_PATH}" "ELECTRON_RUN_AS_NODE=1"; then
    HTTP_NODE_CMD="$BIZOWL_ELECTRON_PATH"
    HTTP_NODE_ARGS=()
    HTTP_NODE_ENV_PREFIX=("ELECTRON_RUN_AS_NODE=1")
    return 0
  fi

  return 1
}

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

http_request() {
  local METHOD="$1"
  local URL="$2"
  local BODY="${3:-}"

  # On Windows Git Bash/MSYS/Cygwin, prefer Node fetch to avoid codepage-related
  # corruption for non-ASCII payloads in curl/wget command-line arguments.
  if ! is_windows_bash; then
    if command -v curl > /dev/null 2>&1; then
      if [ "$METHOD" = "GET" ]; then
        if curl -s -f "$URL" 2>/dev/null; then
          return 0
        fi
      else
        if curl -s -f -X "$METHOD" "$URL" \
          -H "Content-Type: application/json" \
          -d "$BODY" 2>/dev/null; then
          return 0
        fi
      fi
    fi

    if command -v wget > /dev/null 2>&1; then
      if [ "$METHOD" = "GET" ]; then
        if wget -q -O- "$URL" 2>/dev/null; then
          return 0
        fi
      else
        if wget -q -O- --method="$METHOD" \
          --header="Content-Type: application/json" \
          --body-data="$BODY" \
          "$URL" 2>/dev/null; then
          return 0
        fi
      fi
    fi
  fi

  if ! resolve_http_node_runtime; then
    return 127
  fi

  env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" - "$METHOD" "$URL" "$BODY" <<'NODE'
const [method, url, body] = process.argv.slice(2);

(async () => {
  try {
    const init = { method };
    if (method !== 'GET') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = body ?? '';
    }
    const response = await fetch(url, init);
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

http_get() {
  http_request "GET" "$1"
}

http_post_json() {
  local BODY="${2:-}"
  if [ -z "$BODY" ]; then
    BODY='{}'
  fi

  http_request "POST" "$1" "$BODY"
}

build_search_payload() {
  local CONNECTION_ID="$1"
  local QUERY="$2"
  local MAX_RESULTS="$3"
  local ENGINE="$4"
  local FALLBACK_ORDER="$5"

  if resolve_http_node_runtime; then
    env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" - "$CONNECTION_ID" "$QUERY" "$MAX_RESULTS" "$ENGINE" "$FALLBACK_ORDER" <<'NODE'
const [connectionId, query, maxResultsRaw, engineRaw, fallbackOrderRaw] = process.argv.slice(2);
const maxResults = Number.parseInt(maxResultsRaw, 10);
const engine = engineRaw || 'auto';
const fallbackOrder = (fallbackOrderRaw || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const payload = {
  query,
  maxResults: Number.isFinite(maxResults) ? maxResults : 10,
  engine,
};

if (connectionId) {
  payload.connectionId = connectionId;
}

if (fallbackOrder.length > 0) {
  payload.fallbackOrder = fallbackOrder;
}

process.stdout.write(JSON.stringify(payload));
NODE
    return $?
  fi

  # Fallback when Node runtime is unavailable.
  local ESCAPED_QUERY
  ESCAPED_QUERY=$(printf '%s' "$QUERY" | sed 's/\\/\\\\/g; s/"/\\"/g')
  local FALLBACK_JSON=""
  if [ -n "$FALLBACK_ORDER" ]; then
    local ESCAPED_FALLBACK_ORDER
    ESCAPED_FALLBACK_ORDER=$(printf '%s' "$FALLBACK_ORDER" | sed 's/\\/\\\\/g; s/"/\\"/g')
    FALLBACK_JSON=",\"fallbackOrder\":\"$ESCAPED_FALLBACK_ORDER\""
  fi
  printf '{"connectionId":"%s","query":"%s","maxResults":%s,"engine":"%s"%s}' \
    "$CONNECTION_ID" "$ESCAPED_QUERY" "${MAX_RESULTS:-10}" "${ENGINE:-auto}" "$FALLBACK_JSON"
}

ensure_http_client_available() {
  if is_windows_bash; then
    if resolve_http_node_runtime; then
      return 0
    fi
    echo -e "${RED}✗ No supported HTTP client available for web-search on Windows${NC}" >&2
    echo -e "${YELLOW}  Node/Electron runtime is required in Windows shell mode.${NC}" >&2
    return 1
  fi

  if command -v curl > /dev/null 2>&1; then
    return 0
  fi

  if command -v wget > /dev/null 2>&1; then
    return 0
  fi

  if resolve_http_node_runtime; then
    return 0
  fi

  echo -e "${RED}✗ No HTTP client available for web-search${NC}" >&2
  echo -e "${YELLOW}  Install curl or wget, or ensure Node/Electron runtime is available.${NC}" >&2
  return 1
}

is_server_healthy() {
  local BASE_URL="${1%/}"
  local HEALTH_RESPONSE
  HEALTH_RESPONSE=$(http_get "$BASE_URL/api/health" || true)
  echo "$HEALTH_RESPONSE" | grep -q '"success":true' \
    && echo "$HEALTH_RESPONSE" | grep -q "\"service\":\"$BRIDGE_SERVICE_NAME\"" \
    && echo "$HEALTH_RESPONSE" | grep -q "\"apiVersion\":$BRIDGE_API_VERSION"
}

try_switch_to_local_server() {
  if [ "$ACTIVE_SERVER_URL" = "$DEFAULT_SERVER_URL" ]; then
    return 1
  fi

  if is_server_healthy "$DEFAULT_SERVER_URL"; then
    echo -e "${YELLOW}Bridge Server at $ACTIVE_SERVER_URL is unavailable, falling back to ${DEFAULT_SERVER_URL}${NC}" >&2
    ACTIVE_SERVER_URL="$DEFAULT_SERVER_URL"
    return 0
  fi

  return 1
}

wait_for_server_health() {
  local WAITED=0
  while [ "$WAITED" -lt "$REPAIR_WAIT_TIMEOUT" ]; do
    if is_server_healthy "$ACTIVE_SERVER_URL" || try_switch_to_local_server; then
      return 0
    fi
    sleep "$REPAIR_WAIT_INTERVAL"
    WAITED=$((WAITED + REPAIR_WAIT_INTERVAL))
  done
  return 1
}

is_electron_bridge_configured() {
  [ -n "${BIZOWL_ELECTRON_BROWSER_URL:-}" ] && [ -n "${BIZOWL_BRIDGE_SECRET:-}" ]
}

run_electron_bridge_fallback() {
  local QUERY="$1"
  local MAX_RESULTS="${2:-10}"
  local OUTPUT_FORMAT="${3:-markdown}"
  local REASON="${4:-Bridge Server unavailable}"

  if [ "$ELECTRON_FALLBACK_ENABLED" = "0" ]; then
    echo -e "${YELLOW}Electron browser bridge fallback disabled; reason: $REASON${NC}" >&2
    return 1
  fi

  if ! is_electron_bridge_configured; then
    echo -e "${YELLOW}Electron browser bridge fallback unavailable; bridge URL or secret is missing. Reason: $REASON${NC}" >&2
    return 1
  fi

  if ! resolve_http_node_runtime; then
    echo -e "${YELLOW}Electron browser bridge fallback unavailable; no supported Node/Electron runtime. Reason: $REASON${NC}" >&2
    return 1
  fi

  echo -e "${YELLOW}Using Electron browser bridge fallback: $REASON${NC}" >&2
  local ARGS=()
  if [ "$OUTPUT_FORMAT" = "json" ]; then
    ARGS+=("--json")
  fi
  env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" \
    "$SCRIPT_DIR/electron-fallback-search.cjs" "${ARGS[@]}" "$QUERY" "$MAX_RESULTS"
}

retry_start_server_with_force_repair() {
  echo -e "${YELLOW}Bridge Server startup failed, retrying once with force repair...${NC}" >&2
  if WEB_SEARCH_SERVER="$ACTIVE_SERVER_URL" WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
    if wait_for_server_health; then
      return 0
    fi
  fi
  return 1
}

# Check if server is running
check_server() {
  if [ "${WEB_SEARCH_FORCE_REPAIR:-0}" = "1" ]; then
    echo -e "${YELLOW}Force-repair enabled, restarting Bridge Server...${NC}" >&2
    if ! WEB_SEARCH_SERVER="$ACTIVE_SERVER_URL" WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
      if is_server_healthy "$ACTIVE_SERVER_URL" || try_switch_to_local_server; then
        echo -e "${YELLOW}Bridge Server restart returned an error, but a healthy server is available. Continuing...${NC}" >&2
        return 0
      fi
      echo -e "${RED}✗ Failed to force-restart Bridge Server${NC}" >&2
      if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  Recent logs:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    return 1
  fi

    if wait_for_server_health; then
      return 0
    fi

    echo -e "${RED}✗ Bridge Server still unavailable after force restart${NC}" >&2
    echo -e "${YELLOW}  Endpoint checked: $ACTIVE_SERVER_URL/api/health${NC}" >&2
    return 1
  fi

  if is_server_healthy "$ACTIVE_SERVER_URL"; then
    return 0
  fi

  if try_switch_to_local_server; then
    return 0
  fi

  echo -e "${YELLOW}Bridge Server is not running, trying to start it...${NC}" >&2
  if ! WEB_SEARCH_SERVER="$ACTIVE_SERVER_URL" bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
    if retry_start_server_with_force_repair; then
      return 0
    fi
    if is_server_healthy "$ACTIVE_SERVER_URL" || try_switch_to_local_server; then
      echo -e "${YELLOW}Bridge Server startup returned an error, but a healthy server is already available. Continuing...${NC}" >&2
      return 0
    fi
    echo -e "${RED}✗ Failed to auto-start Bridge Server${NC}" >&2
    echo -e "${YELLOW}  Try manually: bash $SCRIPT_DIR/start-server.sh${NC}" >&2
    if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  Recent logs:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    return 1
  fi

  if wait_for_server_health; then
    return 0
  fi

  if retry_start_server_with_force_repair; then
    return 0
  fi

  if ! is_server_healthy "$ACTIVE_SERVER_URL"; then
    echo -e "${RED}✗ Bridge Server still unavailable after start${NC}" >&2
    echo -e "${YELLOW}  Endpoint checked: $ACTIVE_SERVER_URL/api/health${NC}" >&2
    if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  Recent logs:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    return 1
  fi
}

is_iconv_runtime_error() {
  local RESPONSE="$1"
  if echo "$RESPONSE" | grep -q "Cannot find module" && echo "$RESPONSE" | grep -q "encodings"; then
    return 0
  fi
  return 1
}

is_connection_runtime_error() {
  local RESPONSE="$1"
  if echo "$RESPONSE" | grep -q "Connection not found"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Connection not active"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Connection became invalid"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "browserContext.newPage"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Target page, context or browser has been closed"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Failed to connect to CDP"; then
    return 0
  fi
  return 1
}

is_playwright_launch_error() {
  local RESPONSE="$1"
  if echo "$RESPONSE" | grep -qi "Failed to launch browser"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -qi "CDP port not ready"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "browserContext.newPage"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Target page, context or browser has been closed"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -q "Failed to connect to CDP"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -qi "Chrome executable"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -qi "Executable doesn't exist"; then
    return 0
  fi
  if echo "$RESPONSE" | grep -qi "Executable does not exist"; then
    return 0
  fi
  return 1
}

repair_server_runtime() {
  echo -e "${YELLOW}Detected broken web-search runtime, trying automatic repair...${NC}" >&2
  rm -f "$CONNECTION_CACHE"
  bash "$SCRIPT_DIR/stop-server.sh" > /dev/null 2>&1 || true

  if ! WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
    echo -e "${RED}✗ Failed to repair web-search runtime${NC}" >&2
    if [ -f "$PROJECT_DIR/.server.log" ]; then
      echo -e "${YELLOW}  Recent logs:${NC}" >&2
      tail -20 "$PROJECT_DIR/.server.log" >&2
    fi
    return 1
  fi

  sleep 2
  return 0
}

is_cached_connection_valid() {
  local CONNECTION_ID="$1"
  local VALIDATE_RESPONSE
  VALIDATE_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/page/text" "{\"connectionId\":\"$CONNECTION_ID\"}" || true)

  if echo "$VALIDATE_RESPONSE" | grep -q '"success":true'; then
    return 0
  fi

  if is_connection_runtime_error "$VALIDATE_RESPONSE"; then
    return 1
  fi

  # Unknown validation failure should not block new connection creation.
  return 1
}

# Get or create browser connection
get_connection() {
  local ATTEMPT="${1:-1}"
  local CONNECTION_ID=""

  # Try to use cached connection
  if [ -f "$CONNECTION_CACHE" ]; then
    CONNECTION_ID=$(cat "$CONNECTION_CACHE")

    # Verify cached connection is actually usable.
    if [ -n "$CONNECTION_ID" ] && is_cached_connection_valid "$CONNECTION_ID"; then
      echo "$CONNECTION_ID"
      return 0
    fi

    # Stale connection, remove cache
    rm -f "$CONNECTION_CACHE"
  fi

  # Launch browser if not running
  local LAUNCH_RESPONSE
  LAUNCH_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/browser/launch" "{}" || true)

  if ! echo "$LAUNCH_RESPONSE" | grep -q '"success":true'; then
    if [ "$ATTEMPT" -eq 1 ] && is_iconv_runtime_error "$LAUNCH_RESPONSE"; then
      if repair_server_runtime; then
        get_connection 2
        return $?
      fi
    fi
    if [ "$ATTEMPT" -eq 1 ] && is_connection_runtime_error "$LAUNCH_RESPONSE"; then
      rm -f "$CONNECTION_CACHE"
      bash "$SCRIPT_DIR/stop-server.sh" > /dev/null 2>&1 || true
      if WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
        get_connection 2
        return $?
      fi
    fi
    echo -e "${RED}✗ Failed to launch browser${NC}" >&2
    echo "$LAUNCH_RESPONSE" >&2
    return 1
  fi

  # Connect to browser
  local CONNECT_RESPONSE
  CONNECT_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/browser/connect" "{}" || true)

  if ! echo "$CONNECT_RESPONSE" | grep -q '"success":true'; then
    if [ "$ATTEMPT" -eq 1 ] && is_iconv_runtime_error "$CONNECT_RESPONSE"; then
      if repair_server_runtime; then
        get_connection 2
        return $?
      fi
    fi
    if [ "$ATTEMPT" -eq 1 ] && is_connection_runtime_error "$CONNECT_RESPONSE"; then
      rm -f "$CONNECTION_CACHE"
      bash "$SCRIPT_DIR/stop-server.sh" > /dev/null 2>&1 || true
      if WEB_SEARCH_FORCE_REPAIR=1 bash "$SCRIPT_DIR/start-server.sh" > /dev/null 2>&1; then
        get_connection 2
        return $?
      fi
    fi
    echo -e "${RED}✗ Failed to connect to browser${NC}" >&2
    echo "$CONNECT_RESPONSE" >&2
    return 1
  fi

  # Extract connection ID
  CONNECTION_ID=$(echo "$CONNECT_RESPONSE" | grep -o '"connectionId":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$CONNECTION_ID" ]; then
    echo -e "${RED}✗ Failed to get connection ID${NC}" >&2
    return 1
  fi

  # Cache connection ID
  echo "$CONNECTION_ID" > "$CONNECTION_CACHE"
  echo "$CONNECTION_ID"
}

# Perform search
search() {
  local QUERY="$1"
  local MAX_RESULTS="${2:-10}"
  local CONNECTION_ID="$3"
  local ATTEMPT="${4:-1}"
  local OUTPUT_FORMAT="${5:-markdown}"
  local ENGINE="${WEB_SEARCH_ENGINE:-auto}"
  local FALLBACK_ORDER="${WEB_SEARCH_FALLBACK_ORDER:-}"

  echo -e "${BLUE}🔍 Searching for: \"$QUERY\"${NC}" >&2
  echo "" >&2

  # Perform search via API
  local SEARCH_RESPONSE
  local SEARCH_PAYLOAD
  if ! SEARCH_PAYLOAD="$(build_search_payload "$CONNECTION_ID" "$QUERY" "$MAX_RESULTS" "$ENGINE" "$FALLBACK_ORDER")"; then
    echo -e "${RED}✗ Failed to build search payload${NC}" >&2
    return 1
  fi

  SEARCH_RESPONSE=$(http_post_json "$ACTIVE_SERVER_URL/api/search" "$SEARCH_PAYLOAD" || true)

  if ! echo "$SEARCH_RESPONSE" | grep -q '"success":true'; then
    if [ "$ATTEMPT" -eq 1 ] && is_iconv_runtime_error "$SEARCH_RESPONSE"; then
      if repair_server_runtime; then
        if CONNECTION_ID="$(get_connection 2)"; then
          search "$QUERY" "$MAX_RESULTS" "$CONNECTION_ID" 2 "$OUTPUT_FORMAT"
          return $?
        fi
        return 1
      fi
    fi
    if [ "$ATTEMPT" -eq 1 ] && is_connection_runtime_error "$SEARCH_RESPONSE"; then
      rm -f "$CONNECTION_CACHE"
      if CONNECTION_ID="$(get_connection 2)"; then
        search "$QUERY" "$MAX_RESULTS" "$CONNECTION_ID" 2 "$OUTPUT_FORMAT"
        return $?
      fi
    fi
    if [ "$ATTEMPT" -eq 1 ] && is_playwright_launch_error "$SEARCH_RESPONSE"; then
      run_electron_bridge_fallback "$QUERY" "$MAX_RESULTS" "$OUTPUT_FORMAT" "Playwright browser launch failed"
      return $?
    fi
    if echo "$SEARCH_RESPONSE" | grep -q "returned no parsable results"; then
      echo -e "${YELLOW}Search result failure is not a browser launch failure; Electron fallback skipped.${NC}" >&2
    fi
    echo -e "${RED}✗ Search failed${NC}" >&2
    echo "$SEARCH_RESPONSE" >&2
    return 1
  fi

  if [ "$OUTPUT_FORMAT" = "json" ]; then
    if resolve_http_node_runtime; then
      printf '%s' "$SEARCH_RESPONSE" | env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" -e 'let raw=""; process.stdin.on("data", c => raw += c); process.stdin.on("end", () => { const parsed = JSON.parse(raw); process.stdout.write(JSON.stringify(parsed.data, null, 2)); });'
    else
      echo "$SEARCH_RESPONSE"
    fi
    return 0
  fi

  if resolve_http_node_runtime; then
    local MARKDOWN_SCRIPT
    MARKDOWN_SCRIPT='const [query] = process.argv.slice(1);
let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  const parsed = JSON.parse(raw);
  const data = parsed.data || {};
  const engine = data.engine || "unknown";
  const total = typeof data.totalResults === "number" ? data.totalResults : (data.results || []).length;
  const duration = typeof data.duration === "number" ? data.duration : 0;

  process.stderr.write(`\x1b[0;32m✓ Found ${total} results in ${duration}ms (engine: ${engine})\x1b[0m\n\n`);
  process.stdout.write(`# Search Results: ${query}\n\n`);
  process.stdout.write(`**Query:** ${query}  \n`);
  process.stdout.write(`**Engine:** ${engine}  \n`);
  process.stdout.write(`**Results:** ${total}  \n`);
  process.stdout.write(`**Time:** ${duration}ms  \n\n---\n\n`);

  for (const result of data.results || []) {
    process.stdout.write(`## ${result.title || ""}\n\n`);
    process.stdout.write(`**URL:** [${result.url || ""}](${result.url || ""})\n\n`);
    process.stdout.write(`${result.snippet || ""}\n\n---\n\n`);
  }
});
'
    printf '%s' "$SEARCH_RESPONSE" | env "${HTTP_NODE_ENV_PREFIX[@]}" "$HTTP_NODE_CMD" "${HTTP_NODE_ARGS[@]}" -e "$MARKDOWN_SCRIPT" "$QUERY"
    return 0
  fi

  # Parse and display results
  local DURATION=$(echo "$SEARCH_RESPONSE" | grep -o '"duration":[0-9]*' | cut -d':' -f2)
  local TOTAL=$(echo "$SEARCH_RESPONSE" | grep -o '"totalResults":[0-9]*' | head -1 | cut -d':' -f2)
  local ENGINE_USED=$(echo "$SEARCH_RESPONSE" | grep -o '"engine":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$ENGINE_USED" ]; then
    ENGINE_USED="unknown"
  fi

  echo -e "${GREEN}✓ Found $TOTAL results in ${DURATION}ms (engine: ${ENGINE_USED})${NC}" >&2
  echo "" >&2

  # Format results as Markdown
  echo "# Search Results: $QUERY"
  echo ""
  echo "**Query:** $QUERY  "
  echo "**Engine:** $ENGINE_USED  "
  echo "**Results:** $TOTAL  "
  echo "**Time:** ${DURATION}ms  "
  echo ""
  echo "---"
  echo ""

  # Extract and format each result
  # Note: This is a simplified parser. For production, use jq or node.js
  echo "$SEARCH_RESPONSE" | grep -o '"title":"[^"]*","url":"[^"]*","snippet":"[^"]*"' | while IFS= read -r result; do
    local TITLE=$(echo "$result" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')
    local URL=$(echo "$result" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
    local SNIPPET=$(echo "$result" | sed -n 's/.*"snippet":"\([^"]*\)".*/\1/p')

    echo "## $TITLE"
    echo ""
    echo "**URL:** [$URL]($URL)"
    echo ""
    echo "$SNIPPET"
    echo ""
    echo "---"
    echo ""
  done
}

# Close browser after search completes
cleanup_browser() {
  local CONNECTION_ID="$1"

  # Disconnect the Playwright connection
  if [ -n "$CONNECTION_ID" ]; then
    http_post_json "$ACTIVE_SERVER_URL/api/browser/disconnect" "{\"connectionId\":\"$CONNECTION_ID\"}" > /dev/null 2>&1 || true
  fi

  # Close the browser process (only kills the browser spawned by web-search, not user's browser)
  http_post_json "$ACTIVE_SERVER_URL/api/browser/close" "{}" > /dev/null 2>&1 || true

  # Clear connection cache
  rm -f "$CONNECTION_CACHE"
}

# Main execution
main() {
  # Parse arguments
  if [ $# -lt 1 ]; then
    usage
  fi

  local OUTPUT_FORMAT="markdown"
  if [ "${1:-}" = "--json" ]; then
    OUTPUT_FORMAT="json"
    shift
  fi

  if [ $# -lt 1 ]; then
    usage
  fi

  local QUERY_ARG="$1"
  local QUERY="$QUERY_ARG"
  local MAX_RESULTS="${2:-10}"

  # Support @file syntax to avoid command-line encoding issues for non-ASCII query.
  if [ "${QUERY_ARG#@}" != "$QUERY_ARG" ]; then
    local QUERY_FILE="${QUERY_ARG#@}"
    if [ ! -f "$QUERY_FILE" ]; then
      echo -e "${RED}✗ Query file not found: $QUERY_FILE${NC}" >&2
      exit 1
    fi
    QUERY="$(cat "$QUERY_FILE")"
  fi

  if ! ensure_http_client_available; then
    exit 1
  fi

  # Check server
  local SERVER_READY=0
  if ! check_server; then
    SERVER_READY=1
    if run_electron_bridge_fallback "$QUERY" "$MAX_RESULTS" "$OUTPUT_FORMAT" "Bridge Server unavailable after repair"; then
      exit 0
    fi
  fi

  if [ "$SERVER_READY" -ne 0 ]; then
    exit 1
  fi

  # Perform search
  local SEARCH_EXIT_CODE=0
  local CONNECTION_ID=""
  if ! CONNECTION_ID="$(get_connection 1)"; then
    if run_electron_bridge_fallback "$QUERY" "$MAX_RESULTS" "$OUTPUT_FORMAT" "Playwright browser launch failed"; then
      exit 0
    fi
    exit 1
  fi

  if ! search "$QUERY" "$MAX_RESULTS" "$CONNECTION_ID" 1 "$OUTPUT_FORMAT"; then
    SEARCH_EXIT_CODE=1
  fi

  # By default, keep the browser alive so subsequent searches can reuse the
  # existing Chrome process and Playwright connection (avoids re-launching
  # Chrome which steals window focus).  Set WEB_SEARCH_CLEANUP=1 to force
  # cleanup after each search.
  # Legacy: WEB_SEARCH_NO_CLEANUP=1 is now a no-op (kept for compatibility).
  if [ "${WEB_SEARCH_CLEANUP:-}" = "1" ]; then
    cleanup_browser ""
  fi

  exit $SEARCH_EXIT_CODE
}

# Run main function
main "$@"

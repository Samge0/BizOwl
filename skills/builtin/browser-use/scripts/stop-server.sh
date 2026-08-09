#!/bin/bash
# Stop headless browser-use bridge server.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "✓ Browser-use bridge is not running"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if ps -p "$PID" > /dev/null 2>&1; then
  kill "$PID" > /dev/null 2>&1 || true
  sleep 1
  if ps -p "$PID" > /dev/null 2>&1; then
    kill -9 "$PID" > /dev/null 2>&1 || true
  fi
fi

rm -f "$PID_FILE"
echo "✓ Browser-use bridge stopped"

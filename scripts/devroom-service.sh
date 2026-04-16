#!/bin/bash
# devroom-service.sh — launchd wrapper for DEVROOM
# Reads ~/.devroom/mode and starts in dev or prod accordingly.

set -euo pipefail

# launchd starts with a minimal environment — source Homebrew + node/pnpm/claude
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="/opt/homebrew/bin:$PATH"

# fnm (if used) or nvm — uncomment whichever applies:
# eval "$(fnm env)"
# export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

DEVROOM_DIR="/Users/nyhzdev/devroom/nyhzops-devroom"
MODE_FILE="$HOME/.devroom/mode"

cd "$DEVROOM_DIR"

# Load .env.local
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

# Read mode (default: prod)
MODE="prod"
if [ -f "$MODE_FILE" ]; then
  MODE=$(cat "$MODE_FILE" | tr -d '[:space:]')
fi

PORT="${DEVROOM_PORT:-7777}"

# Pre-start cleanup — kill any process still holding our port from a previous
# run. launchd's SIGKILL bypasses our SIGTERM trap, leaving orphan servers
# (and 10+GB of leaked turbopack cache) behind. Belt-and-braces: lsof by port,
# then pkill by command pattern under our working directory.
kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[DEVROOM] Port ${port} held by PIDs: ${pids} — sending SIGTERM"
    kill $pids 2>/dev/null || true
    # Give them 5s to exit gracefully, then SIGKILL survivors
    for _ in 1 2 3 4 5; do
      pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      [ -z "$pids" ] && break
      sleep 1
    done
    if [ -n "$pids" ]; then
      echo "[DEVROOM] Port ${port} still held — sending SIGKILL to ${pids}"
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

kill_port "$PORT"

# Also sweep any stray devroom server processes that may have lost their port
# binding but still hold memory (e.g. crashed next-server workers).
pkill -f "tsx server.ts" 2>/dev/null || true
pkill -f "next-server.*${DEVROOM_DIR}" 2>/dev/null || true
sleep 1

echo "[DEVROOM] Starting in ${MODE} mode on port ${PORT}..."

# Ensure ALL child processes (pnpm → tsx → node) die when this script is killed.
# Without this, launchctl kickstart -k kills only this bash process and the
# node server becomes an orphan holding the port — restarts silently fail.
cleanup() {
  kill -- -$$ 2>/dev/null || true
}
trap cleanup SIGTERM SIGINT EXIT

if [ "$MODE" = "dev" ]; then
  pnpm dev &
else
  echo "[DEVROOM] Building for production..."
  pnpm build
  pnpm start &
fi

# Wait for the background process — this keeps the script alive so launchd
# tracks this PID. The trap ensures children are killed on SIGTERM.
wait

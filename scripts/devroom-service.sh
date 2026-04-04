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

echo "[DEVROOM] Starting in ${MODE} mode..."

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

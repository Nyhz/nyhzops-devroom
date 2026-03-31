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

if [ "$MODE" = "dev" ]; then
  exec pnpm dev
else
  echo "[DEVROOM] Building for production..."
  pnpm build
  exec pnpm start
fi

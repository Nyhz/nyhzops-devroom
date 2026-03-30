#!/bin/bash
# sync-claude-credentials.sh
# Extracts Claude Code OAuth tokens from macOS Keychain and writes to a file
# that the DEVROOM Docker container mounts for agent authentication.
#
# The script triggers a token refresh via `claude auth status` before extracting,
# ensuring the copied credentials are always fresh.
#
# Usage: Run via launchd every 2 hours (see com.devroom.claude-credentials-sync.plist).

set -euo pipefail

CLAUDE_BIN="${CLAUDE_BIN:-/opt/homebrew/bin/claude}"
DEST="${DEVROOM_CREDENTIALS_DEST:-${HOME}/.devroom/claude-credentials.json}"
LOG_TAG="claude-cred-sync"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*"; }

mkdir -p "$(dirname "$DEST")"

# --- Step 1: Trigger token refresh via CLI ---
# Claude Code auto-refreshes expired/near-expiry tokens when invoked.
# Running `auth status` is lightweight and updates the Keychain if needed.
log "Triggering token refresh via CLI..."
if ! "$CLAUDE_BIN" auth status > /dev/null 2>&1; then
  log "ERROR — claude auth status failed. CLI may need manual re-login."
  exit 1
fi
log "CLI auth OK."

# --- Step 2: Extract credentials from macOS Keychain ---
CRED=$(security find-generic-password -s "Claude Code-credentials" -g 2>&1 \
  | grep "^password:" \
  | sed 's/^password: "//' \
  | sed 's/"$//')

if [ -z "$CRED" ]; then
  log "ERROR — Failed to extract credentials from Keychain"
  exit 1
fi

# --- Step 3: Validate JSON and check expiration ---
# Use osascript (JavaScript Core, built into macOS) — no python3 needed
EXPIRES_AT=$(osascript -l JavaScript -e "
  var d = JSON.parse(\`$CRED\`);
  if (!d.claudeAiOauth) throw 'missing claudeAiOauth';
  d.claudeAiOauth.expiresAt;
" 2>/dev/null) || {
  log "ERROR — Credential data is not valid JSON or missing claudeAiOauth key"
  exit 1
}
NOW_MS=$(($(date +%s) * 1000))
REMAINING_MS=$((EXPIRES_AT - NOW_MS))
REMAINING_H=$(osascript -l JavaScript -e "($REMAINING_MS / 3600000).toFixed(1)")

if [ "$EXPIRES_AT" -le "$NOW_MS" ]; then
  log "WARNING — Token is EXPIRED. CLI refresh may have failed. Remaining: ${REMAINING_H}h"
  exit 1
fi

THREE_HOURS_MS=$((3 * 3600000))
if [ "$REMAINING_MS" -lt "$THREE_HOURS_MS" ]; then
  log "WARNING — Token expires in ${REMAINING_H}h (under 3h threshold)"
fi

# --- Step 4: Write credentials ---
echo "$CRED" > "$DEST"
chmod 600 "$DEST"
log "OK — Credentials synced to $DEST (expires in ${REMAINING_H}h)"

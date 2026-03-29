#!/bin/bash
# sync-claude-credentials.sh
# Extracts Claude Code OAuth tokens from macOS Keychain and writes to a file
# that the DEVROOM Docker container mounts for agent authentication.
#
# Usage: Run via launchd or cron every 4 hours.
#   crontab example: 0 */4 * * * /path/to/sync-claude-credentials.sh

set -euo pipefail

DEST="${DEVROOM_CREDENTIALS_DEST:-${HOME}/.devroom/claude-credentials.json}"
mkdir -p "$(dirname "$DEST")"

# Extract credential JSON from macOS Keychain
CRED=$(security find-generic-password -s "Claude Code-credentials" -g 2>&1 \
  | grep "^password:" \
  | sed 's/^password: "//' \
  | sed 's/"$//')

if [ -z "$CRED" ]; then
  echo "$(date): ERROR — Failed to extract credentials from Keychain" >&2
  exit 1
fi

# Validate it's parseable JSON with the expected key
if ! echo "$CRED" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'claudeAiOauth' in d" 2>/dev/null; then
  echo "$(date): ERROR — Credential data is not valid JSON or missing claudeAiOauth key" >&2
  exit 1
fi

echo "$CRED" > "$DEST"
chmod 600 "$DEST"
echo "$(date): OK — Credentials synced to $DEST"

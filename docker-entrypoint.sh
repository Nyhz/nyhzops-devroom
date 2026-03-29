#!/bin/sh
# Copy Claude Code config from read-only mount to writable home.
# The host file is bind-mounted at /seed/.claude.json — we copy it once
# at boot so container processes never read a half-written host file.

SEED_JSON="/seed/.claude.json"
DEST_JSON="$HOME/.claude.json"

if [ -f "$SEED_JSON" ]; then
  cp "$SEED_JSON" "$DEST_JSON"
  echo "[entrypoint] Seeded $DEST_JSON from host"
fi

# Git identity for agent commits
git config --global user.name "DEVROOM"
git config --global user.email "nyhzops@devroom.lan"

exec "$@"
